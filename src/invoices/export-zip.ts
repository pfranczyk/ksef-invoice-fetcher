/**
 * Operacje na plikach ZIP
 * Scalanie, walidacja, ekstrakcja
 */

import AdmZip from 'adm-zip';
import type { ILogger, IPackageInfo, IPackagePart } from '../types.ts';
import { isZipMagicBytes } from './export-crypto.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * Wpis w archiwum ZIP
 */
type TZipEntry = {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly content: Buffer | null;
};

/**
 * Parametry scalania i walidacji ZIP
 */
type TAssembleAndValidateZipParams = {
  readonly decryptedParts: Buffer[];
  readonly packageInfo: IPackageInfo;
  readonly logger: ILogger;
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Scala i waliduje części ZIP
 * @param {TAssembleAndValidateZipParams} params - Parametry
 * @returns {Buffer} Scalony plik ZIP
 * @throws {Error} Gdy rozmiar nie zgadza się lub plik nie jest ZIP
 */
export function assembleAndValidateZip({ decryptedParts, packageInfo, logger }: TAssembleAndValidateZipParams): Buffer {
  // Oblicz oczekiwany rozmiar
  const expectedSize: number = packageInfo.parts.reduce(
    (sum: number, part: IPackagePart): number => sum + part.partSize,
    0,
  );

  // Oblicz faktyczny rozmiar
  const actualSize: number = decryptedParts.reduce((sum: number, part: Buffer): number => sum + part.length, 0);

  logger.debug(`Rozmiar paczki: oczekiwany=${expectedSize}, faktyczny=${actualSize}`);

  if (expectedSize !== actualSize) {
    throw new Error(`Niezgodność rozmiaru paczki: oczekiwano ${expectedSize} bajtów, otrzymano ${actualSize} bajtów`);
  }

  // Scalenie części
  const zipBuffer: Buffer = Buffer.concat(decryptedParts);

  // Sprawdź magic bytes ZIP
  if (!isZipMagicBytes(zipBuffer)) {
    throw new Error('Scalony plik nie jest prawidłowym archiwum ZIP (błędne magic bytes)');
  }

  logger.info(`✓ Paczka ZIP zwalidowana pomyślnie (rozmiar: ${zipBuffer.length} bajtów)`);

  return zipBuffer;
}

/**
 * Ekstrahuje wpisy z archiwum ZIP
 * @param {Buffer} zipBuffer - Bufor ZIP
 * @returns {TZipEntry[]} Lista wpisów { name, isDirectory, content }
 * @throws {Error} Gdy nie udało się rozpakować archiwum ZIP
 */
export function extractZipEntries(zipBuffer: Buffer): TZipEntry[] {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  return entries.map(
    (entry: AdmZip.IZipEntry): TZipEntry => ({
      name: entry.entryName,
      isDirectory: entry.isDirectory,
      content: entry.isDirectory ? null : entry.getData(),
    }),
  );
}
