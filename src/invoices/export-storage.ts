/**
 * Zapis faktur i metadanych na dysk
 */

import { basename, join } from 'node:path';
import type { ILogger } from '../types.ts';
import { createDirectory, writeBinaryFile } from '../utils/file-system.ts';
import { extractZipEntries } from './export-zip.ts';

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
 * Struktura metadanych faktur
 */
interface IInvoiceMetadata {
  invoices: unknown[];
}

/**
 * Parametry rozpakowywania i zapisu faktur
 */
type TUnpackAndStoreInvoicesParams = {
  readonly zipBuffer: Buffer;
  readonly outputBaseDir: string;
  readonly monthFolder: string;
  readonly logger: ILogger;
};

/**
 * Wynik rozpakowywania i zapisu faktur
 */
type TUnpackAndStoreInvoicesReturn = {
  readonly invoiceCount: number;
  readonly metadataCount: number;
  readonly targetDir: string;
  readonly inconsistentMetadata: boolean;
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Rozpakuje ZIP i zapisze faktury oraz metadane
 * @param {TUnpackAndStoreInvoicesParams} params - Parametry
 * @returns {Promise<TUnpackAndStoreInvoicesReturn>} Podsumowanie { invoiceCount, metadataCount, targetDir, inconsistentMetadata }
 * @throws {Error} Gdy brak _metadata.json lub błąd parsowania
 */
export async function unpackAndStoreInvoices({
  zipBuffer,
  outputBaseDir,
  monthFolder,
  logger,
}: TUnpackAndStoreInvoicesParams): Promise<TUnpackAndStoreInvoicesReturn> {
  // Wyodrębnij wpisy z ZIP
  const entries: TZipEntry[] = extractZipEntries(zipBuffer);

  logger.debug(`Znaleziono ${entries.length} wpisów w archiwum ZIP`);

  // Znajdź _metadata.json
  const metadataEntry: TZipEntry | undefined = entries.find(
    (e: TZipEntry): boolean => !e.isDirectory && e.name === '_metadata.json',
  );

  if (!metadataEntry) {
    throw new Error('Brak pliku _metadata.json w archiwum ZIP');
  }

  // Parsuj metadane
  let metadata: IInvoiceMetadata;
  try {
    const rawContent = metadataEntry.content?.toString('utf-8');
    if (!rawContent) {
      throw new Error('Plik _metadata.json jest pusty lub nie ma zawartości');
    }
    metadata = JSON.parse(rawContent as string);
  } catch (error: unknown) {
    const err = error as Error;
    throw new Error(`Nie udało się sparsować _metadata.json: ${err.message}`);
  }

  // Łagodna walidacja metadanych
  if (!Array.isArray(metadata.invoices)) {
    throw new Error('_metadata.json nie jest tablicą');
  }

  let inconsistentMetadata: boolean = false;

  // Sprawdź, czy każdy element jest obiektem
  for (let i = 0; i < metadata.invoices.length; i++) {
    if (typeof metadata.invoices[i] !== 'object' || metadata.invoices[i] === null) {
      logger.warn(`_metadata.json: element [${i}] nie jest obiektem`);
      inconsistentMetadata = true;
    }
  }

  // Zbierz pliki XML
  const xmlFiles: TZipEntry[] = entries.filter((e: TZipEntry): boolean => !e.isDirectory && e.name.endsWith('.xml'));

  logger.info(`Znaleziono ${xmlFiles.length} plików XML i ${metadata.invoices.length} rekordów metadanych`);

  // Walidacja spójności (łagodna)
  if (xmlFiles.length !== metadata.invoices.length) {
    logger.warn(
      `Niezgodność liczby plików XML (${xmlFiles.length}) i rekordów metadanych (${metadata.invoices.length})`,
    );
    inconsistentMetadata = true;
  }

  // Utwórz katalog docelowy
  const targetDir: string = join(outputBaseDir, monthFolder);
  await createDirectory(targetDir);

  // Zapisz pliki XML
  for (const xmlFile of xmlFiles) {
    if (xmlFile.content === null) {
      continue;
    }
    const fileName: string = basename(xmlFile.name);
    const filePath: string = join(targetDir, fileName);
    await writeBinaryFile(filePath, xmlFile.content);
  }

  // Zapisz _metadata.json
  if (metadataEntry.content === null) {
    throw new Error('Plik _metadata.json nie zawiera danych');
  }
  const metadataPath: string = join(targetDir, '_metadata.json');
  await writeBinaryFile(metadataPath, metadataEntry.content);

  logger.info(`✓ Zapisano ${xmlFiles.length} faktur do katalogu: ${targetDir}`);

  return {
    invoiceCount: xmlFiles.length,
    metadataCount: metadata.invoices.length,
    targetDir,
    inconsistentMetadata,
  };
}
