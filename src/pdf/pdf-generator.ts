/**
 * Główny orkiestrator procesu generowania PDF
 * Pipeline: XML → parse → mapInvoiceData → docDefinition (pdfmake) → PDF
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createDirectory, fileExists } from '../utils/file-system.ts';
import logger from '../utils/logger.ts';
import { buildInvoicePdfDocDefinition } from './pdf-template.ts';
import { writePdfToFile } from './pdf-writer.ts';
import { mapInvoiceData, parseInvoiceXml } from './xml-parser.ts';

/**
 * Opcje generowania PDF
 */
type TGeneratePdfOptions = {
  month: string;
  xmlDir: string;
  pdfDir: string;
  startDay?: number;
  endDay?: number;
};

/**
 * Statystyki procesu generowania PDF
 */
interface IGenerateStats {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ file: string; error: string }>;
}

/**
 * Metadane pojedynczej faktury
 */
interface IInvoiceMetadataItem {
  ksefNumber: string;
  issueDate: string;
}

/**
 * Struktura pliku _metadata.json
 */
interface IMetadataFile {
  invoices: IInvoiceMetadataItem[];
}

/**
 * Wynik funkcji prepareDirectories
 */
interface IDirectoryPaths {
  xmlMonthDir: string;
  pdfMonthDir: string;
}

/**
 * Główna funkcja generowania PDF dla faktur z określonego miesiąca
 * @param {Object} options - Opcje generowania
 * @param {string} options.month - Miesiąc w formacie YYYY-MM
 * @param {string} options.xmlDir - Katalog bazowy z fakturami XML
 * @param {string} options.pdfDir - Katalog bazowy docelowy PDF
 * @param {number} options.startDay - Dzień początkowy filtrowania (opcjonalny, 1-31)
 * @param {number} options.endDay - Dzień końcowy filtrowania (opcjonalny, 1-31)
 * @returns {Promise<Object>} - Statystyki procesu
 * @throws {Error} Gdy parametry, katalog faktur lub metadane są niepoprawne
 */
export async function generatePdfForMonth(options: TGeneratePdfOptions): Promise<IGenerateStats> {
  const startTime = Date.now();

  logger.info('='.repeat(60));
  logger.info('GENEROWANIE PDF ROZPOCZĘTE');
  logger.info('='.repeat(60));
  logger.info(`Miesiąc: ${options.month}`);

  if (options.startDay || options.endDay) {
    logger.info(`Filtr dni: ${options.startDay || 1} do ${options.endDay || 'koniec miesiąca'}`);
  }

  const stats: IGenerateStats = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Krok 1: Walidacja parametrów
    logger.info('Krok 1/4: Walidacja parametrów');
    await validateParameters(options);

    // Krok 2: Przygotowanie katalogów
    logger.info('Krok 2/4: Przygotowanie katalogów');
    const { xmlMonthDir, pdfMonthDir } = await prepareDirectories(options);

    // Krok 3: Wczytanie metadanych faktur
    logger.info('Krok 3/4: Wczytywanie metadanych faktur');
    const invoices = await loadInvoiceMetadata(xmlMonthDir, options);
    stats.total = invoices.length;

    if (invoices.length === 0) {
      logger.warn('Brak faktur dla podanych kryteriów');
      return stats;
    }

    logger.info(`Znaleziono ${invoices.length} faktur do przetworzenia`);

    // Krok 4: Przetwarzanie każdej faktury
    logger.info('Krok 4/4: Przetwarzanie faktur');
    await processInvoices(invoices, xmlMonthDir, pdfMonthDir, stats);

    // Podsumowanie
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info('='.repeat(60));
    logger.info('GENEROWANIE PDF ZAKOŃCZONE');
    logger.info(`Łącznie faktur: ${stats.total}`);
    logger.info(`Wygenerowano poprawnie: ${stats.success}`);
    logger.info(`Nieudane: ${stats.failed}`);
    logger.info(`Pominięte: ${stats.skipped}`);
    logger.info(`Czas trwania: ${duration}s`);
    logger.info(`Lokalizacja plików PDF: ${pdfMonthDir}`);
    logger.info('='.repeat(60));

    // Jeśli były błędy, wyświetl je
    if (stats.errors.length > 0) {
      logger.warn('\nWystąpiły błędy:');
      stats.errors.forEach((err: { file: string; error: string }, idx: number) => {
        logger.warn(`${idx + 1}. ${err.file}: ${err.error}`);
      });
    }

    return stats;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Generowanie PDF nie powiodło się: ${errorMessage}`);
    throw error;
  }
}

/**
 * Waliduje parametry wejściowe
 * @param {TGeneratePdfOptions} options - Opcje generowania
 * @returns {Promise<void>}
 * @throws {Error} Gdy format miesiąca lub zakres dni jest nieprawidłowy
 */
async function validateParameters(options: TGeneratePdfOptions): Promise<void> {
  // Walidacja formatu miesiąca (YYYY-MM)
  const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!monthRegex.test(options.month)) {
    throw new Error(`Nieprawidłowy format miesiąca: ${options.month}. Oczekiwany format: YYYY-MM`);
  }

  // Walidacja dni (jeśli podane)
  if (options.startDay) {
    if (options.startDay < 1 || options.startDay > 31) {
      throw new Error(`Nieprawidłowy dzień początkowy: ${options.startDay}. Musi być w zakresie 1-31`);
    }
  }

  if (options.endDay) {
    if (options.endDay < 1 || options.endDay > 31) {
      throw new Error(`Nieprawidłowy dzień końcowy: ${options.endDay}. Musi być w zakresie 1-31`);
    }
  }

  if (options.startDay && options.endDay) {
    if (options.startDay > options.endDay) {
      throw new Error(
        `Dzień początkowy (${options.startDay}) nie może być większy niż dzień końcowy (${options.endDay})`,
      );
    }
  }

  logger.debug('Parametry zweryfikowane poprawnie');
}

/**
 * Przygotowuje katalogi robocze
 * @param {TGeneratePdfOptions} options - Opcje generowania
 * @returns {Promise<IDirectoryPaths>} Ścieżki katalogu faktur i katalogu PDF (per miesiąc)
 * @throws {Error} Gdy katalog z fakturami XML nie istnieje
 */
async function prepareDirectories(options: TGeneratePdfOptions): Promise<IDirectoryPaths> {
  const [, month] = options.month.split('-');

  const xmlMonthDir = join(options.xmlDir, month);

  if (!(await fileExists(xmlMonthDir))) {
    throw new Error(
      `Nie znaleziono katalogu faktur: ${xmlMonthDir}\nNajpierw pobierz faktury używając: ksef fetch --df ${options.month}`,
    );
  }

  const pdfMonthDir = join(options.pdfDir, month);
  await createDirectory(pdfMonthDir);
  logger.debug(`Katalog wyjściowy PDF: ${pdfMonthDir}`);

  return { xmlMonthDir, pdfMonthDir };
}

/**
 * Wczytuje metadane faktur i filtruje według kryteriów
 * @param {string} xmlMonthDir - Katalog miesiąca z fakturami XML
 * @param {TGeneratePdfOptions} options - Opcje generowania (filtr dni)
 * @returns {Promise<IInvoiceMetadataItem[]>} Lista faktur po filtracji
 * @throws {Error} Gdy plik _metadata.json nie istnieje
 */
async function loadInvoiceMetadata(xmlMonthDir: string, options: TGeneratePdfOptions): Promise<IInvoiceMetadataItem[]> {
  const metadataPath = join(xmlMonthDir, '_metadata.json');

  if (!(await fileExists(metadataPath))) {
    throw new Error(`Nie znaleziono pliku metadanych: ${metadataPath}`);
  }

  const metadataContent = await fs.readFile(metadataPath, 'utf-8');
  const metadata: IMetadataFile = JSON.parse(metadataContent);

  let invoices = metadata.invoices || [];

  // Filtrowanie według dni (jeśli określone)
  if (options.startDay || options.endDay) {
    const startDay = options.startDay ?? 1;
    const endDay = options.endDay ?? 31;

    invoices = invoices.filter((invoice: IInvoiceMetadataItem) => {
      // Pobierz dzień z daty faktury (issueDate: "2026-01-24")
      const invoiceDate = new Date(invoice.issueDate);
      const day = invoiceDate.getDate();

      return day >= startDay && day <= endDay;
    });

    logger.info(`Przefiltrowano ${invoices.length} faktur dla dni ${startDay}-${endDay}`);
  }

  return invoices;
}

/**
 * Przetwarza wszystkie faktury: XML → dane → PDF (pdfmake)
 * @param {IInvoiceMetadataItem[]} invoices - Lista faktur do przetworzenia
 * @param {string} xmlMonthDir - Katalog miesiąca z fakturami XML
 * @param {string} pdfMonthDir - Katalog miesiąca docelowy PDF
 * @param {IGenerateStats} stats - Statystyki (mutowane)
 * @returns {Promise<void>}
 */
async function processInvoices(
  invoices: IInvoiceMetadataItem[],
  xmlMonthDir: string,
  pdfMonthDir: string,
  stats: IGenerateStats,
): Promise<void> {
  for (let i = 0; i < invoices.length; i++) {
    const invoice = invoices[i];
    const invoiceNumber = i + 1;

    logger.info(`\n[${invoiceNumber}/${invoices.length}] Przetwarzanie: ${invoice.ksefNumber}`);

    try {
      const xmlFileName = `${invoice.ksefNumber}.xml`;
      const xmlPath = join(xmlMonthDir, xmlFileName);

      if (!(await fileExists(xmlPath))) {
        logger.warn(`Brak pliku XML: ${xmlFileName} - pomijam`);
        stats.skipped++;
        continue;
      }

      logger.debug('Parsowanie XML...');
      const parsedXml = await parseInvoiceXml(xmlPath);

      logger.debug('Mapowanie danych faktury...');
      const invoiceData = mapInvoiceData(parsedXml, xmlFileName);

      logger.debug('Budowanie definicji PDF...');
      const docDefinition = buildInvoicePdfDocDefinition(invoiceData);

      const pdfFileName = `${invoice.ksefNumber}.pdf`;
      const pdfPath = join(pdfMonthDir, pdfFileName);
      logger.debug('Zapisywanie PDF...');
      await writePdfToFile(docDefinition, pdfPath);

      stats.success++;
      logger.info(`✓ Wygenerowano poprawnie: ${pdfFileName}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      stats.failed++;
      stats.errors.push({
        file: invoice.ksefNumber,
        error: errorMessage,
      });
      logger.error(`✗ Nie udało się przetworzyć ${invoice.ksefNumber}: ${errorMessage}`);
    }
  }
}
