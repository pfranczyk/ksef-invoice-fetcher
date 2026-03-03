/**
 * Punkt wejścia aplikacji KSeF Invoice Fetcher
 * Etap 1: Logowanie do systemu KSeF
 * Etap 2: Pobieranie faktur
 * Etap 3: Generowanie faktur PDF
 */
import { Command } from 'commander';
import { authenticate } from './auth/ksef-token-auth.ts';
import { getValidAccessToken, saveTokens } from './auth/token-manager.ts';
import { getConfig, validateConfig } from './config/env.ts';
import { runSingleExport } from './invoices/export-service.ts';
import { generatePdfForMonth } from './pdf/pdf-generator.ts';
import type { IConfig } from './types.ts';
import logger, { maskSensitiveData } from './utils/logger.ts';
import {
  parseMonthToDateRange,
  type TValidateDateRangeReturn,
  validateDateRange,
  validateNIP,
  validatePath,
} from './utils/validator.ts';

// Zmienna globalna dla graceful shutdown — przypisywana gdy eksport używa katalogu tymczasowego na HDD
const currentTempDir: string | null = null;

/** Opcje CLI przekazywane do funkcji pomocniczych */
type TCliOptions = {
  readonly dateFrom?: string | true;
  readonly dateTo?: string;
  readonly output?: string;
  readonly generatePdf?: string | true;
  readonly template?: string;
  readonly pdfOutput?: string;
  readonly startDay?: string;
  readonly endDay?: string;
};

/**
 * Handler dla SIGINT (Ctrl+C)
 */
async function handleShutdown(): Promise<void> {
  logger.info('\nAplikacja przerwana przez użytkownika');

  if (currentTempDir) {
    try {
      const { deleteDirectory, fileExists } = await import('./utils/file-system.ts');
      if (await fileExists(currentTempDir)) {
        logger.info(`Czyszczenie plików tymczasowych: ${currentTempDir}`);
        await deleteDirectory(currentTempDir);
        logger.info('Pliki tymczasowe usunięte pomyślnie');
      }
    } catch (error) {
      logger.error(`Nie udało się wyczyścić plików tymczasowych: ${(error as Error).message}`);
    }
  }

  logger.info('Zamykanie aplikacji');
  process.exit(0);
}

// Rejestracja handlera SIGINT
process.on('SIGINT', handleShutdown);

/**
 * Zwraca poprzedni miesiąc kalendarzowy w formacie YYYY-MM.
 * @returns Poprzedni miesiąc, np. "2026-01" gdy bieżący to luty 2026
 */
function getPreviousMonth(): string {
  const now = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth(); // getMonth() zwraca 0-11
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Parsuje i waliduje zakres dat z opcji CLI.
 * @param {TCliOptions} options - Opcje CLI z Commander.js
 * @returns {TValidateDateRangeReturn | null} Zakres dat lub null (tryb testu autoryzacji)
 */
function resolveDateRange(options: TCliOptions): TValidateDateRangeReturn | null {
  // Rozwiąż wartość --df: true (flaga bez argumentu) → poprzedni miesiąc kalendarzowy
  let dateFrom: string | undefined;
  if (options.dateFrom === true) {
    dateFrom = getPreviousMonth();
    logger.info(`Nie podano daty dla --df, używam poprzedniego miesiąca: ${dateFrom}`);
  } else {
    dateFrom = options.dateFrom;
  }

  const hasDateFrom = !!dateFrom;
  const hasDateTo = !!options.dateTo;
  const isMonthFormat = hasDateFrom && /^\d{4}-\d{2}$/.test(dateFrom!);

  if (!hasDateFrom && hasDateTo) {
    logger.error('Dla eksportu faktur musisz podać jednocześnie --df i --dt (zakres jednego miesiąca).');
    process.exit(1);
  }

  if (hasDateFrom && !hasDateTo && !isMonthFormat) {
    logger.error(
      'Podano --df w formacie YYYY-MM-DD bez --dt. Użyj formatu YYYY-MM (np. --df 2026-02) aby pobrać cały miesiąc, lub dodaj --dt.',
    );
    process.exit(1);
  }

  if (isMonthFormat && !hasDateTo) {
    const dateRange = parseMonthToDateRange(dateFrom!);
    const fromStr = dateRange.from.toISOString().slice(0, 10);
    const toStr = dateRange.to.toISOString().slice(0, 10);
    logger.info(`Zakres dat (z miesiąca ${dateFrom}): ${fromStr} do ${toStr}`);
    return dateRange;
  }

  if (hasDateFrom && hasDateTo) {
    const dateRange = validateDateRange(dateFrom!, options.dateTo!);
    logger.info(`Zakres dat: ${dateFrom} do ${options.dateTo}`);
    return dateRange;
  }

  // Tryb testu autoryzacji — daty nie są wymagane
  logger.info('Nie podano zakresu dat (tryb testu autoryzacji)');
  return null;
}

/**
 * Obsługuje tryb generowania PDF i kończy proces.
 * @param {TCliOptions} options - Opcje CLI z Commander.js
 * @param {IConfig} config - Konfiguracja aplikacji
 * @returns {Promise<void>}
 */
async function runPdfMode(options: TCliOptions, config: IConfig): Promise<void> {
  logger.info('');
  logger.info('=== GENEROWANIE PDF ===');

  if (options.output) {
    validatePath(options.output, '--output');
  }
  if (options.template) {
    validatePath(options.template, '--template');
  }
  if (options.pdfOutput) {
    validatePath(options.pdfOutput, '--pdf-output');
  }

  // Rozwiąż wartość --generate-pdf: true (flaga bez argumentu) → poprzedni miesiąc kalendarzowy
  let pdfMonth: string;
  if (options.generatePdf === true) {
    pdfMonth = getPreviousMonth();
    logger.info(`Nie podano miesiąca dla --generate-pdf, używam poprzedniego miesiąca: ${pdfMonth}`);
  } else {
    pdfMonth = options.generatePdf!;
  }

  const pdfOptions = {
    month: pdfMonth,
    outputDir: options.output || config.outputDir,
    templatePath: options.template || config.templatePath || undefined,
    pdfOutputDir: options.pdfOutput,
    startDay: options.startDay !== undefined ? parseInt(options.startDay, 10) : undefined,
    endDay: options.endDay !== undefined ? parseInt(options.endDay, 10) : undefined,
  };

  const stats = await generatePdfForMonth(pdfOptions);
  process.exit(stats.failed > 0 ? 1 : 0);
}

/**
 * Obsługuje tryb pobierania faktur: autoryzacja i opcjonalny eksport.
 * @param {TCliOptions} options - Opcje CLI z Commander.js
 * @param {IConfig} config - Konfiguracja aplikacji
 * @param {TValidateDateRangeReturn | null} dateRange - Zakres dat lub null (tryb testu autoryzacji)
 * @returns {Promise<void>}
 */
async function runFetchMode(
  options: TCliOptions,
  config: IConfig,
  dateRange: TValidateDateRangeReturn | null,
): Promise<void> {
  const outputDir = options.output || config.outputDir;
  if (options.output) {
    validatePath(options.output, '--output');
  }
  logger.debug(`Katalog wyjściowy: ${outputDir}`);

  logger.info('Sprawdzanie zapisanej sesji...');
  let tokens = await getValidAccessToken(config);

  if (!tokens) {
    logger.info('Wymagana pełna autoryzacja');
    tokens = await authenticate(config);
    await saveTokens(tokens.accessToken, tokens.refreshToken, config);
  }

  logger.info('✓ Pomyślnie zautoryzowano w KSeF');

  const accessTokenStr = tokens.accessToken;
  if (accessTokenStr) {
    logger.debug(`Token dostępu: ${maskSensitiveData(accessTokenStr)}`);
  }

  if (dateRange) {
    logger.info('');
    logger.info('=== POBIERANIE FAKTUR XML ===');
    const exportResult = await runSingleExport({
      config,
      accessToken: accessTokenStr,
      dateRange,
      outputDir,
      logger,
    });

    if (exportResult.noInvoices) {
      logger.info('');
      logger.info('Brak faktur w podanym zakresie dat; eksport zakończony bez błędu.');
    } else if (exportResult.hadInvoices) {
      logger.info('');
      logger.info(`Pobrano ${exportResult.invoiceCount} faktur do katalogu ${exportResult.targetDir}.`);

      if (exportResult.isTruncated) {
        logger.warn('⚠ Dane mogą być niepełne (eksport obcięty) – wykonaj dodatkowe eksporty.');
      }
      if (exportResult.inconsistentMetadata) {
        logger.warn('⚠ Wykryto niespójności w metadanych – sprawdź logi powyżej.');
      }
    }
  } else {
    logger.info('');
    logger.info('=== TEST AUTORYZACJI ZAKOŃCZONY POMYŚLNIE ===');
    logger.info('Token zapisany do przyszłego użycia.');
    logger.info('Uruchom z parametrami --df i --dt aby pobrać faktury.');
  }
}

/**
 * Główna funkcja aplikacji
 */
async function main(): Promise<void> {
  let exitCode = 0;

  const program = new Command();

  program
    .name('ksef-invoice-fetcher')
    .description('Aplikacja do pobierania faktur z KSeF API 2.0')
    .version('0.6.0')
    .option('--df, --date-from [date]', 'Data początkowa (format: YYYY-MM-DD lub YYYY-MM), domyślnie: poprzedni miesiąc')
    .option('--dt, --date-to <date>', 'Data końcowa (format: YYYY-MM-DD)')
    .option('-o, --output <dir>', 'Katalog wyjściowy (opcjonalny)')
    .option('--generate-pdf [month]', 'Generuj PDF dla faktur z miesiąca (format: YYYY-MM), domyślnie: poprzedni miesiąc')
    .option('--template <path>', 'Ścieżka do szablonu DOCX (opcjonalna)')
    .option('--pdf-output <dir>', 'Katalog wyjściowy dla PDF (opcjonalny)')
    .option('--start-day <day>', 'Dzień początkowy filtrowania (1-31)')
    .option('--end-day <day>', 'Dzień końcowy filtrowania (1-31)');

  program.parse(process.argv);

  const options = program.opts<TCliOptions>();

  try {
    const config = getConfig();

    validateConfig(config);

    logger.info(`KSeF Invoice Fetcher v0.6.0`);
    logger.info(`Środowisko: ${config.env}`);
    logger.info(`API URL: ${config.baseUrl}`);

    if (options.generatePdf) {
      await runPdfMode(options, config);
      return;
    }

    validateNIP(config.nip);
    logger.debug(`NIP validated: ${maskSensitiveData(config.nip)}`);

    const dateRange = resolveDateRange(options);
    await runFetchMode(options, config, dateRange);

    logger.info('Zakończono');
  } catch (err) {
    const error = err as Error;
    logger.error(`Error: ${error.message}`);

    if (error.stack) {
      logger.debug(error.stack);
    }

    exitCode = 1;
  } finally {
    process.exit(exitCode);
  }
}

// Uruchomienie aplikacji
main().catch((reason) => {
  logger.error(`Nieoczekiwany błąd: ${(reason as Error).message}`);
  process.exit(1);
});
