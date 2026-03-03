/**
 * Główny orchestrator eksportu faktur
 */

import type { IConfig, ILogger } from '../types.ts';
import { toISODateTimeString } from '../utils/validator.ts';
import { initExport, waitForExportCompletion } from './export-api.ts';
import { generateEncryptionParams } from './export-crypto.ts';
import { downloadAndDecryptParts } from './export-download.ts';
import { unpackAndStoreInvoices } from './export-storage.ts';
import { assembleAndValidateZip } from './export-zip.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * Zakres dat eksportu
 */
type TDateRange = {
  readonly from: Date;
  readonly to: Date;
};

/**
 * Parametry pojedynczego eksportu
 */
type TRunSingleExportParams = {
  readonly config: IConfig;
  readonly accessToken: string;
  readonly dateRange: TDateRange;
  readonly outputDir: string;
  readonly logger: ILogger;
};

/**
 * Wynik pojedynczego eksportu
 */
type TRunSingleExportReturn = {
  readonly success: boolean;
  readonly invoiceCount: number;
  readonly hadInvoices: boolean;
  readonly noInvoices?: boolean;
  readonly metadataCount?: number;
  readonly targetDir?: string;
  readonly isTruncated?: boolean;
  readonly inconsistentMetadata?: boolean;
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Wykonuje pojedynczy eksport faktur
 * @param {TRunSingleExportParams} params - Parametry
 * @returns {Promise<TRunSingleExportReturn>} Wynik eksportu
 * @throws {Error} Gdy eksport zakończył się błędem
 */
export async function runSingleExport({
  config,
  accessToken,
  dateRange,
  outputDir,
  logger,
}: TRunSingleExportParams): Promise<TRunSingleExportReturn> {
  try {
    // 1. Start
    logger.info('');
    logger.info('=== ROZPOCZĘCIE EKSPORTU FAKTUR ===');
    logger.info(`Środowisko: ${config.env}`);
    logger.info(`API URL: ${config.baseUrl}`);
    logger.info(
      `Zakres dat: ${toISODateTimeString(dateRange.from, false)} do ${toISODateTimeString(dateRange.to, true)}`,
    );
    logger.info(`Katalog wyjściowy: ${outputDir}`);

    // 2. Generowanie parametrów szyfrowania
    logger.info('');
    logger.info('Generowanie parametrów szyfrowania...');
    const encryption = await generateEncryptionParams(config);
    logger.info('✓ Parametry szyfrowania wygenerowane');

    // 3. Budowa filtrów eksportu
    const filters = {
      subjectType: 'Subject2',
      dateRange: {
        dateType: 'Invoicing',
        from: toISODateTimeString(dateRange.from, false),
        to: toISODateTimeString(dateRange.to, true),
      },
    };

    logger.debug(`Filtry: ${JSON.stringify(filters, null, 2)}`);

    // 4. Inicjalizacja eksportu
    logger.info('');
    logger.info('Inicjalizacja eksportu...');
    const referenceNumber: string = await initExport({ config, accessToken, encryption, filters });
    logger.info(`✓ Eksport zainicjowany, numer referencyjny: ${referenceNumber}`);

    // 5. Polling statusu eksportu
    logger.info('');
    logger.info('Oczekiwanie na zakończenie eksportu...');
    const exportStatus = await waitForExportCompletion({ config, accessToken, referenceNumber, logger });

    // 6. Obsługa kodów statusu
    const statusCode: number | undefined = exportStatus.status?.code;
    const packageData = exportStatus.package;

    // Scenariusz: brak paczki (brak faktur)
    if (statusCode === 200 && !packageData) {
      logger.info('');
      logger.info('=== EKSPORT ZAKOŃCZONY ===');
      logger.info('Brak faktur w podanym zakresie dat (status 200, brak paczki).');
      return {
        success: true,
        invoiceCount: 0,
        hadInvoices: false,
        noInvoices: true,
      };
    }

    // Scenariusz: jest paczka
    if (statusCode === 200 && packageData) {
      logger.info('');
      logger.info(`Liczba faktur w paczce: ${packageData.invoiceCount}`);
      logger.info(`Rozmiar paczki: ${packageData.size} bajtów`);
      logger.info(`Liczba części: ${packageData.parts.length}`);

      // Scenariusz: paczka istnieje ale jest pusta (0 faktur)
      if (packageData.invoiceCount === 0 || packageData.parts.length === 0) {
        logger.info('');
        logger.info('=== EKSPORT ZAKOŃCZONY ===');
        logger.info('Brak faktur w podanym zakresie dat (paczka pusta).');
        return {
          success: true,
          invoiceCount: 0,
          hadInvoices: false,
          noInvoices: true,
        };
      }

      // Ostrzeżenie o obcięciu
      if (packageData.isTruncated) {
        logger.warn('');
        logger.warn('⚠ UWAGA: Eksport jest niekompletny (isTruncated=true)');
        logger.warn('⚠ Paczka nie zawiera wszystkich faktur z podanego zakresu.');
        logger.warn('⚠ Należy wykonać dodatkowe eksporty.');
      }

      // 7. Sprawdzenie ważności paczki
      const packageExpirationDate: string | undefined = exportStatus.packageExpirationDate;
      if (packageExpirationDate && new Date(packageExpirationDate) < new Date()) {
        throw new Error('Paczka wygasła przed rozpoczęciem pobierania');
      }

      // 8. Pobieranie i odszyfrowanie części
      logger.info('');
      const decryptedParts: Buffer[] = await downloadAndDecryptParts({
        parts: packageData.parts,
        aesKey: encryption.aesKey,
        iv: encryption.iv,
        packageExpirationDate: packageExpirationDate!,
        logger,
      });

      // 9. Scalanie i walidacja ZIP
      logger.info('');
      logger.info('Scalanie i walidacja paczki ZIP...');
      const zipBuffer: Buffer = assembleAndValidateZip({
        decryptedParts,
        packageInfo: packageData,
        logger,
      });

      // 10. Rozpakowanie i zapis plików
      logger.info('');
      logger.info('Rozpakowanie i zapis faktur...');

      // Wyznacz monthFolder na podstawie daty początkowej
      const month: string = String(dateRange.from.getMonth() + 1).padStart(2, '0');

      const result = await unpackAndStoreInvoices({
        zipBuffer,
        outputBaseDir: outputDir,
        monthFolder: month,
        logger,
      });

      // Krytyczna walidacja: invoiceCount > 0 ale puste metadata
      if (packageData.invoiceCount > 0 && result.metadataCount === 0) {
        throw new Error(
          `Błąd spójności eksportu: package.invoiceCount=${packageData.invoiceCount}, ` +
            `ale _metadata.json jest puste (eksport ${referenceNumber}, zakres ${filters.dateRange.from}–${filters.dateRange.to}).`,
        );
      }

      // 11. Zakończenie
      logger.info('');
      logger.info('=== EKSPORT ZAKOŃCZONY SUKCESEM ===');
      logger.info(`Pobrano ${result.invoiceCount} faktur`);
      logger.info(`Katalog: ${result.targetDir}`);

      if (result.inconsistentMetadata) {
        logger.warn('⚠ Wykryto niespójności w metadanych (szczegóły w logach powyżej)');
      }

      if (packageData.isTruncated) {
        logger.warn('⚠ Eksport jest niekompletny (isTruncated=true)');
      }

      return {
        success: true,
        invoiceCount: result.invoiceCount,
        metadataCount: result.metadataCount,
        targetDir: result.targetDir,
        hadInvoices: true,
        isTruncated: packageData.isTruncated || false,
        inconsistentMetadata: result.inconsistentMetadata,
      };
    }

    // Nie powinniśmy tu dotrzeć
    throw new Error(`Nieobsługiwany scenariusz: statusCode=${statusCode}, package=${!!packageData}`);
  } catch (error: unknown) {
    const err = error as Error;
    logger.error('');
    logger.error('=== EKSPORT ZAKOŃCZONY BŁĘDEM ===');
    logger.error(`Błąd: ${err.message}`);
    if (err.stack) {
      logger.debug(`Stack trace: ${err.stack}`);
    }
    throw error;
  }
}
