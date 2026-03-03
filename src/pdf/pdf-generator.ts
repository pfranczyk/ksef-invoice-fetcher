/**
 * Główny orkiestrator procesu generowania PDF
 * Odpowiedzialny za koordynację całego procesu
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createDirectory, deleteFile, fileExists } from '../utils/file-system.ts';
import logger from '../utils/logger.ts';
import { convertDocxToPdf } from './docx-to-pdf.ts';
import { processTemplate, validateTemplate } from './template-processor.ts';
import { mapInvoiceData, parseInvoiceXml } from './xml-parser.ts';

/**
 * Opcje generowania PDF
 */
type TGeneratePdfOptions = {
  month: string;
  outputDir: string;
  templatePath?: string;
  pdfOutputDir?: string;
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
  monthDir: string;
  pdfDir: string;
  tempDir: string;
}

/**
 * Główna funkcja generowania PDF dla faktur z określonego miesiąca
 * @param {Object} options - Opcje generowania
 * @param {string} options.month - Miesiąc w formacie YYYY-MM
 * @param {string} options.outputDir - Katalog bazowy (np. 'output')
 * @param {string} options.templatePath - Ścieżka do szablonu DOCX (opcjonalna)
 * @param {string} options.pdfOutputDir - Katalog dla PDF (opcjonalna)
 * @param {number} options.startDay - Dzień początkowy filtrowania (opcjonalny, 1-31)
 * @param {number} options.endDay - Dzień końcowy filtrowania (opcjonalny, 1-31)
 * @returns {Promise<Object>} - Statystyki procesu
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
    logger.info('Krok 1/6: Walidacja parametrów');
    await validateParameters(options);

    // Krok 2: Przygotowanie katalogów
    logger.info('Krok 2/6: Przygotowanie katalogów');
    const { monthDir, pdfDir, tempDir } = await prepareDirectories(options);

    // Krok 3: Walidacja/przygotowanie szablonu
    logger.info('Krok 3/6: Walidacja szablonu');
    const templatePath = await prepareTemplate(options.templatePath);

    // Krok 4: Wczytanie metadanych faktur
    logger.info('Krok 4/6: Wczytywanie metadanych faktur');
    const invoices = await loadInvoiceMetadata(monthDir, options);
    stats.total = invoices.length;

    if (invoices.length === 0) {
      logger.warn('Brak faktur dla podanych kryteriów');
      return stats;
    }

    logger.info(`Znaleziono ${invoices.length} faktur do przetworzenia`);

    // Krok 5: Przetwarzanie każdej faktury
    logger.info('Krok 5/6: Przetwarzanie faktur');
    await processInvoices(invoices, monthDir, templatePath, tempDir, pdfDir, stats);

    // Krok 6: Czyszczenie
    logger.info('Krok 6/6: Czyszczenie plików tymczasowych');
    await cleanupTempFiles(tempDir);

    // Podsumowanie
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info('='.repeat(60));
    logger.info('GENEROWANIE PDF ZAKOŃCZONE');
    logger.info(`Łącznie faktur: ${stats.total}`);
    logger.info(`Wygenerowano poprawnie: ${stats.success}`);
    logger.info(`Nieudane: ${stats.failed}`);
    logger.info(`Pominięte: ${stats.skipped}`);
    logger.info(`Czas trwania: ${duration}s`);
    logger.info(`Lokalizacja plików PDF: ${pdfDir}`);
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
 */
async function prepareDirectories(options: TGeneratePdfOptions): Promise<IDirectoryPaths> {
  const [, month] = options.month.split('-');

  // Katalog z fakturami XML
  const monthDir = join(options.outputDir, month);

  // Sprawdź czy katalog z fakturami istnieje
  if (!(await fileExists(monthDir))) {
    throw new Error(
      `Nie znaleziono katalogu faktur: ${monthDir}\nNajpierw pobierz faktury używając: --df ${options.month}-01 --dt ${options.month}-31`,
    );
  }

  // Katalog dla PDF (domyślnie output/{MM}/pdf/)
  const pdfDir = options.pdfOutputDir || join(monthDir, 'pdf');
  await createDirectory(pdfDir);
  logger.debug(`Katalog wyjściowy PDF: ${pdfDir}`);

  // Katalog tymczasowy dla pośrednich plików DOCX
  const tempDir = join(monthDir, '.temp-pdf');
  await createDirectory(tempDir);
  logger.debug(`Katalog tymczasowy: ${tempDir}`);

  return { monthDir, pdfDir, tempDir };
}

/**
 * Przygotowuje szablon DOCX
 */
async function prepareTemplate(templatePath: string | undefined): Promise<string> {
  if (!templatePath) {
    throw new Error(
      'Wymagana jest ścieżka do szablonu. Podaj plik DOCX przez --template lub ustaw TEMPLATE_DOCX w .env',
    );
  }

  // Użyj wskazanego szablonu
  logger.info(`Używam szablonu: ${templatePath}`);

  const isValid = await validateTemplate(templatePath);
  if (!isValid) {
    throw new Error(`Nieprawidłowy lub uszkodzony plik szablonu: ${templatePath}`);
  }

  return templatePath;
}

/**
 * Wczytuje metadane faktur i filtruje według kryteriów
 */
async function loadInvoiceMetadata(monthDir: string, options: TGeneratePdfOptions): Promise<IInvoiceMetadataItem[]> {
  const metadataPath = join(monthDir, '_metadata.json');

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
 * Przetwarza wszystkie faktury
 */
async function processInvoices(
  invoices: IInvoiceMetadataItem[],
  monthDir: string,
  templatePath: string,
  tempDir: string,
  pdfDir: string,
  stats: IGenerateStats,
): Promise<void> {
  for (let i = 0; i < invoices.length; i++) {
    const invoice = invoices[i];
    const invoiceNumber = i + 1;

    logger.info(`\n[${invoiceNumber}/${invoices.length}] Przetwarzanie: ${invoice.ksefNumber}`);

    try {
      // Ścieżka do pliku XML
      const xmlFileName = `${invoice.ksefNumber}.xml`;
      const xmlPath = join(monthDir, xmlFileName);

      // Sprawdź czy plik XML istnieje
      if (!(await fileExists(xmlPath))) {
        logger.warn(`Brak pliku XML: ${xmlFileName} - pomijam`);
        stats.skipped++;
        continue;
      }

      // Krok 1: Parsuj XML
      logger.debug('Parsowanie XML...');
      const parsedXml = await parseInvoiceXml(xmlPath);

      // Krok 2: Mapuj dane
      logger.debug('Mapowanie danych faktury...');
      const invoiceData = mapInvoiceData(parsedXml, xmlFileName);

      // Krok 3: Wypełnij szablon DOCX
      const tempDocxPath = join(tempDir, `${invoice.ksefNumber}.docx`);
      logger.debug('Wypełnianie szablonu...');
      await processTemplate(templatePath, invoiceData, tempDocxPath);

      // Krok 4: Konwertuj DOCX na PDF
      const pdfFileName = `${invoice.ksefNumber}.pdf`;
      const pdfPath = join(pdfDir, pdfFileName);
      logger.debug('Konwersja do PDF...');
      await convertDocxToPdf(tempDocxPath, pdfPath);

      // Usuń tymczasowy DOCX
      await deleteFile(tempDocxPath);

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

/**
 * Czyści pliki tymczasowe
 */
async function cleanupTempFiles(tempDir: string): Promise<void> {
  try {
    // Usuń wszystkie pliki w katalogu tymczasowym
    const files = await fs.readdir(tempDir);

    for (const file of files) {
      const filePath = join(tempDir, file);
      await deleteFile(filePath);
    }

    // Usuń katalog tymczasowy
    await fs.rmdir(tempDir);

    logger.debug('Pliki tymczasowe usunięte');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`Nie udało się posprzątać plików tymczasowych: ${errorMessage}`);
  }
}
