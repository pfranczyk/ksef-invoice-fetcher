/**
 * Pobieranie i deszyfrowanie części paczki eksportu
 */

import type { ILogger, IPackagePart } from '../types.ts';
import { TIMEOUTS } from '../utils/http-client.ts';
import logger from '../utils/logger.ts';
import { sleep } from '../utils/sleep.ts';
import { computeSha256Base64, decryptAes256Cbc } from './export-crypto.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * Parametry pobierania i deszyfrowania części
 */
type TDownloadAndDecryptPartsParams = {
  readonly parts: IPackagePart[];
  readonly aesKey: Buffer;
  readonly iv: Buffer;
  readonly packageExpirationDate: string;
  readonly logger: ILogger;
};

// ============================================================================
// Constants
// ============================================================================

/**
 * Czas oczekiwania (ms) przed ponowną próbą pobrania części paczki po błędzie sieciowym.
 */
const DOWNLOAD_RETRY_DELAY_MS = 20_000;

// ============================================================================
// Functions
// ============================================================================

/**
 * Pobiera plik binarny z URL z timeoutem
 * @param {string} url - URL pliku
 * @param {string} method - Metoda HTTP (GET, POST, etc.)
 * @returns {Promise<Buffer>} Zawartość pliku
 * @throws {Error} Gdy nie udało się pobrać pliku lub timeout
 */
async function downloadBinary(url: string, method: string = 'GET'): Promise<Buffer> {
  const controller: AbortController = new AbortController();
  const timeoutId: NodeJS.Timeout = setTimeout((): void => controller.abort(), TIMEOUTS.DOWNLOAD);

  try {
    const response: Response = await fetch(url, {
      method,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const arrayBuffer: ArrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error: unknown) {
    clearTimeout(timeoutId);

    const err = error as Error & { name?: string };
    if (err.name === 'AbortError') {
      throw new Error(`Request timeout po ${TIMEOUTS.DOWNLOAD}ms podczas pobierania pliku`);
    }
    throw error;
  }
}

/**
 * Sprawdza czy data wygasła
 * @param {string} expirationDate - Data w formacie ISO
 * @returns {boolean} true jeśli wygasła
 */
function isExpired(expirationDate: string): boolean {
  if (!expirationDate) return false;
  return new Date(expirationDate) < new Date();
}

/**
 * Pobiera i odszyfrowuje jedną część paczki (z retry dla błędów klasy B)
 * @param {IPackagePart} part - Informacje o części
 * @param {Buffer} aesKey - Klucz AES
 * @param {Buffer} iv - IV
 * @param {string} packageExpirationDate - Data wygaśnięcia paczki
 * @returns {Promise<Buffer>} Odszyfrowana część
 * @throws {Error} Gdy nie udało się pobrać lub odszyfrować części
 */
async function downloadAndDecryptPart(
  part: IPackagePart,
  aesKey: Buffer,
  iv: Buffer,
  packageExpirationDate: string,
): Promise<Buffer> {
  const { ordinalNumber, url, method, encryptedPartHash, partHash, expirationDate } = part;

  let attempt: number = 0;

  while (true) {
    attempt++;

    // Sprawdź wygaśnięcie przed każdą próbą
    if (expirationDate && isExpired(expirationDate)) {
      throw new Error(`Link do części ${ordinalNumber} wygasł – uruchom eksport ponownie`);
    }

    if (isExpired(packageExpirationDate)) {
      throw new Error(`Paczka wygasła przed pobraniem części ${ordinalNumber} – uruchom eksport ponownie`);
    }

    try {
      // Pobierz zaszyfrowane dane
      const encryptedData: Buffer = await downloadBinary(url, method);

      // Weryfikuj hash zaszyfrowanych danych
      const actualEncryptedHash: string = computeSha256Base64(encryptedData);
      if (encryptedPartHash && actualEncryptedHash !== encryptedPartHash) {
        throw new Error(
          `Część ${ordinalNumber}: niezgodność encryptedPartHash. ` +
            `Oczekiwano: ${encryptedPartHash}, otrzymano: ${actualEncryptedHash}`,
        );
      }

      // Odszyfruj
      const decryptedData: Buffer = decryptAes256Cbc({ encryptedData, aesKey, iv });

      // Weryfikuj hash odszyfrowanych danych (opcjonalnie)
      if (partHash) {
        const actualPartHash: string = computeSha256Base64(decryptedData);
        if (actualPartHash !== partHash) {
          logger.warn(
            `Część ${ordinalNumber}: niezgodność partHash. ` + `Oczekiwano: ${partHash}, otrzymano: ${actualPartHash}`,
          );
        }
      }

      logger.info(`✓ Pobrano i odszyfrowano część ${ordinalNumber} (rozmiar: ${decryptedData.length} bajtów)`);
      return decryptedData;
    } catch (error: unknown) {
      const err = error as Error & { code?: string };
      const isNetworkError: boolean =
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ENOTFOUND' ||
        err.message.includes('503') ||
        err.message.includes('504');

      if (!isNetworkError) {
        // Inne błędy (np. niezgodność hashy) - nie retry
        throw error;
      }

      // Błąd klasy B - retry po DOWNLOAD_RETRY_DELAY_MS
      logger.error(`Błąd pobierania części ${ordinalNumber}: ${err.message}`);
      logger.info(`Czekam ${DOWNLOAD_RETRY_DELAY_MS / 1000} sekund przed ponowną próbą... (próba ${attempt})`);
      await sleep(DOWNLOAD_RETRY_DELAY_MS);
      // Kontynuuj pętlę (brak limitu prób dla klasy B)
    }
  }
}

/**
 * Pobiera i odszyfrowuje wszystkie części paczki
 * @param {TDownloadAndDecryptPartsParams} params - Parametry
 * @returns {Promise<Buffer[]>} Tablica odszyfrowanych części
 * @throws {Error} Gdy nie udało się pobrać lub odszyfrować części
 */
export async function downloadAndDecryptParts({
  parts,
  aesKey,
  iv,
  packageExpirationDate,
  logger,
}: TDownloadAndDecryptPartsParams): Promise<Buffer[]> {
  try {
    // Sortuj części po ordinalNumber rosnąco
    const sortedParts: IPackagePart[] = [...parts].sort(
      (a: IPackagePart, b: IPackagePart): number => a.ordinalNumber - b.ordinalNumber,
    );

    logger.info(`Pobieranie ${sortedParts.length} części paczki...`);

    // Sprawdź wygaśnięcie paczki przed rozpoczęciem
    if (isExpired(packageExpirationDate)) {
      throw new Error('Paczka wygasła przed rozpoczęciem pobierania');
    }

    const decryptedParts: Buffer[] = [];

    for (const part of sortedParts) {
      const decrypted: Buffer = await downloadAndDecryptPart(part, aesKey, iv, packageExpirationDate);
      decryptedParts.push(decrypted);
    }

    return decryptedParts;
  } catch (error: unknown) {
    const err = error as Error;
    logger.error(`Błąd w downloadAndDecryptParts: ${err.message}`);
    if (err.stack) {
      logger.debug(`Stack trace: ${err.stack}`);
    }
    throw error;
  }
}
