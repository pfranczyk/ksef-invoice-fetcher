/**
 * Klient API eksportu faktur
 * Operacje: inicjalizacja eksportu, polling statusu
 */

import type { IConfig, ILogger, IPackageInfo } from '../types.ts';
import { httpRequest, TIMEOUTS } from '../utils/http-client.ts';
import logger from '../utils/logger.ts';
import { sleep } from '../utils/sleep.ts'; // używane przez waitForExportCompletion (polling)

// ============================================================================
// Types
// ============================================================================

/**
 * Status eksportu z API
 */
interface IExportStatusCode {
  code: number;
  description?: string;
}

/**
 * Odpowiedź API ze statusem eksportu
 */
interface IExportStatusResponse {
  status?: IExportStatusCode;
  package?: IPackageInfo;
  packageExpirationDate?: string;
}

/**
 * Odpowiedź API z inicjalizacją eksportu
 */
interface IInitExportResponse {
  referenceNumber: string;
}

/**
 * Parametry szyfrowania
 */
type TEncryption = {
  readonly encryptedSymmetricKey: string;
  readonly initializationVector: string;
};

/**
 * Filtry eksportu
 */
type TExportFilters = {
  readonly subjectType: string;
  readonly dateRange: {
    readonly dateType: string;
    readonly from: string;
    readonly to: string;
  };
};

/**
 * Parametry inicjalizacji eksportu
 */
type TInitExportParams = {
  readonly config: IConfig;
  readonly accessToken: string;
  readonly encryption: TEncryption;
  readonly filters: TExportFilters;
};

/**
 * Parametry pobierania statusu eksportu
 */
type TGetExportStatusParams = {
  readonly config: IConfig;
  readonly accessToken: string;
  readonly referenceNumber: string;
};

/**
 * Parametry oczekiwania na zakończenie eksportu
 */
type TWaitForExportCompletionParams = {
  readonly config: IConfig;
  readonly accessToken: string;
  readonly referenceNumber: string;
  readonly logger: ILogger;
};

// ============================================================================
// Constants
// ============================================================================

/**
 * Kody statusów eksportu KSeF
 */
type TKsefExportStatus = {
  readonly IN_PROGRESS: 100;
  readonly SUCCESS: 200;
  readonly EXPIRED: 210;
  readonly DECRYPTION_ERROR: 415;
  readonly DATE_RANGE_ERROR: 420;
  readonly INTERNAL_ERROR: 500;
  readonly CANCELLED: 550;
};

const KSEF_EXPORT_STATUS = Object.freeze<TKsefExportStatus>({
  IN_PROGRESS: 100,
  SUCCESS: 200,
  EXPIRED: 210,
  DECRYPTION_ERROR: 415,
  DATE_RANGE_ERROR: 420,
  INTERNAL_ERROR: 500,
  CANCELLED: 550,
});

// ============================================================================
// Functions
// ============================================================================

/**
 * Inicjalizuje eksport faktur
 * @param {TInitExportParams} params - Parametry
 * @returns {Promise<string>} Numer referencyjny
 * @throws {Error} Gdy nie udało się zainicjalizować eksportu
 */
export async function initExport({ config, accessToken, encryption, filters }: TInitExportParams): Promise<string> {
  try {
    const url: string = `${config.baseUrl}/v2/invoices/exports`;

    const body = {
      encryption: {
        encryptedSymmetricKey: encryption.encryptedSymmetricKey,
        initializationVector: encryption.initializationVector,
      },
      filters,
    };

    logger.debug(`Inicjalizacja eksportu: POST ${url}`);

    const response: Response = await httpRequest(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      },
      { maxRetries: 5, timeout: TIMEOUTS.EXPORT_INIT, context: 'initExport' },
    );

    if (!response.ok) {
      const errorText: string = await response.text().catch((): string => '');
      throw new Error(
        `Nie udało się zainicjalizować eksportu: HTTP ${response.status}${errorText ? ` - ${errorText}` : ''}`,
      );
    }

    const data: IInitExportResponse = await response.json();
    return data.referenceNumber;
  } catch (error: unknown) {
    const err = error as Error;
    logger.error(`Błąd w initExport: ${err.message}`);
    if (err.stack) {
      logger.debug(`Stack trace: ${err.stack}`);
    }
    throw error;
  }
}

/**
 * Pobiera status eksportu
 * @param {TGetExportStatusParams} params - Parametry
 * @returns {Promise<IExportStatusResponse>} Status eksportu
 * @throws {Error} Gdy nie udało się pobrać statusu eksportu
 */
export async function getExportStatus({
  config,
  accessToken,
  referenceNumber,
}: TGetExportStatusParams): Promise<IExportStatusResponse> {
  try {
    const url: string = `${config.baseUrl}/v2/invoices/exports/${referenceNumber}`;

    const response: Response = await httpRequest(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      },
      { timeout: TIMEOUTS.EXPORT_STATUS },
    );

    if (!response.ok) {
      const errorText: string = await response.text().catch((): string => '');
      throw new Error(
        `Nie udało się pobrać statusu eksportu: HTTP ${response.status}${errorText ? ` - ${errorText}` : ''}`,
      );
    }

    return await response.json();
  } catch (error: unknown) {
    const err = error as Error;
    logger.error(`Błąd w getExportStatus dla ${referenceNumber}: ${err.message}`);
    if (err.stack) {
      logger.debug(`Stack trace: ${err.stack}`);
    }
    throw error;
  }
}

/**
 * Czeka na zakończenie eksportu (polling)
 * @param {TWaitForExportCompletionParams} params - Parametry
 * @returns {Promise<IExportStatusResponse>} Finalny status eksportu
 * @throws {Error} Gdy eksport zakończył się błędem lub timeout
 */
export async function waitForExportCompletion({
  config,
  accessToken,
  referenceNumber,
  logger,
}: TWaitForExportCompletionParams): Promise<IExportStatusResponse> {
  try {
    const pollIntervalSeconds: number = config.exportPollIntervalSeconds;
    const maxWaitMinutes: number = config.exportStatusMaxWaitMinutes;
    const maxWaitMs: number = maxWaitMinutes > 0 ? maxWaitMinutes * 60 * 1000 : 0;

    type TStatusHandler = (
      status: IExportStatusResponse,
    ) => { action: 'continue' } | { action: 'return'; value: IExportStatusResponse };

    const statusHandlers: Record<number, TStatusHandler> = {
      [KSEF_EXPORT_STATUS.IN_PROGRESS]: (): { action: 'continue' } => {
        logger.info(
          `Eksport w toku (kod ${KSEF_EXPORT_STATUS.IN_PROGRESS}). Kolejna próba za ${pollIntervalSeconds} sekund...`,
        );
        return { action: 'continue' };
      },
      [KSEF_EXPORT_STATUS.SUCCESS]: (
        status: IExportStatusResponse,
      ): { action: 'return'; value: IExportStatusResponse } => {
        logger.info(`Eksport zakończony sukcesem (kod ${KSEF_EXPORT_STATUS.SUCCESS})`);
        return { action: 'return', value: status };
      },
      [KSEF_EXPORT_STATUS.EXPIRED]: (): never => {
        throw new Error(`Eksport faktur wygasł (status ${KSEF_EXPORT_STATUS.EXPIRED}). Uruchom eksport ponownie.`);
      },
      [KSEF_EXPORT_STATUS.DECRYPTION_ERROR]: (): never => {
        throw new Error(
          `Błąd odszyfrowania dostarczonego klucza (status ${KSEF_EXPORT_STATUS.DECRYPTION_ERROR}). Sprawdź implementację szyfrowania.`,
        );
      },
      [KSEF_EXPORT_STATUS.DATE_RANGE_ERROR]: (): never => {
        throw new Error(
          `Zakres dat jest poza dostępnym zakresem danych w KSeF (status ${KSEF_EXPORT_STATUS.DATE_RANGE_ERROR}).`,
        );
      },
      [KSEF_EXPORT_STATUS.INTERNAL_ERROR]: (): never => {
        throw new Error(`Błąd wewnętrzny KSeF (status ${KSEF_EXPORT_STATUS.INTERNAL_ERROR}) podczas eksportu faktur.`);
      },
      [KSEF_EXPORT_STATUS.CANCELLED]: (): never => {
        throw new Error(`Operacja eksportu została anulowana przez KSeF (status ${KSEF_EXPORT_STATUS.CANCELLED}).`);
      },
    };

    const startTime: number = Date.now();
    let iteration: number = 0;

    while (true) {
      iteration++;

      // Sprawdź timeout (jeśli ustawiony)
      if (maxWaitMs > 0 && Date.now() - startTime > maxWaitMs) {
        throw new Error(`Przekroczono limit oczekiwania na status eksportu po ${maxWaitMinutes} min`);
      }

      const status: IExportStatusResponse = await getExportStatus({ config, accessToken, referenceNumber });
      const statusCode: number | undefined = status.status?.code;

      logger.debug(
        `Sprawdzenie statusu eksportu #${iteration}: kod=${statusCode}, opis="${status.status?.description || ''}"`,
      );

      const handler: TStatusHandler | undefined = statusCode !== undefined ? statusHandlers[statusCode] : undefined;
      if (handler) {
        const result = handler(status);
        if (result.action === 'continue') {
          await sleep(pollIntervalSeconds * 1000);
        } else if (result.action === 'return') {
          return result.value;
        }
      } else {
        // Nieznany status
        throw new Error(`Nieoczekiwany status eksportu: ${statusCode} - ${status.status?.description || 'brak opisu'}`);
      }
    }
  } catch (error: unknown) {
    const err = error as Error;
    logger.error(`Błąd w waitForExportCompletion dla ${referenceNumber}: ${err.message}`);
    if (err.stack) {
      logger.debug(`Stack trace: ${err.stack}`);
    }
    throw error;
  }
}
