/**
 * Komenda `ksef fetch` — autoryzacja + eksport faktur XML z zakresu dat.
 */
import { runSingleExport } from '../invoices/export-service.ts';
import logger from '../utils/logger.ts';
import {
  parseMonthToDateRange,
  type TValidateDateRangeReturn,
  validateDateRange,
  validateNIP,
} from '../utils/validator.ts';
import { authenticate, loadConfig, type TGlobalOpts } from './_shared.ts';

/** Opcje komendy `fetch` */
export type TFetchOpts = {
  readonly df: string;
  readonly dt?: string;
};

/**
 * Parsuje i waliduje zakres dat z opcji komendy fetch (--df jest wymagane).
 * Format YYYY-MM (cały miesiąc) lub YYYY-MM-DD z --dt.
 * @param {TFetchOpts} opts - Opcje komendy fetch
 * @returns {TValidateDateRangeReturn} Zakres dat (from/to)
 * @throws {Error} Gdy --df w formacie YYYY-MM-DD podano bez --dt
 */
function resolveDateRange(opts: TFetchOpts): TValidateDateRangeReturn {
  const dateFrom = opts.df;
  const dateTo = opts.dt;
  const isMonthFormat = /^\d{4}-\d{2}$/.test(dateFrom);

  if (dateTo === undefined && !isMonthFormat) {
    throw new Error(
      'Podano --df w formacie YYYY-MM-DD bez --dt. Użyj formatu YYYY-MM (np. --df 2026-02) aby pobrać cały miesiąc, lub dodaj --dt.',
    );
  }

  if (isMonthFormat && dateTo === undefined) {
    const dateRange = parseMonthToDateRange(dateFrom);
    const fromStr = dateRange.from.toISOString().slice(0, 10);
    const toStr = dateRange.to.toISOString().slice(0, 10);
    logger.info(`Zakres dat (z miesiąca ${dateFrom}): ${fromStr} do ${toStr}`);
    return dateRange;
  }

  const dateRange = validateDateRange(dateFrom, dateTo as string);
  logger.info(`Zakres dat: ${dateFrom} do ${dateTo}`);
  return dateRange;
}

/**
 * Handler komendy `fetch`: autoryzuje i pobiera faktury XML z zakresu dat.
 * @param {TFetchOpts} opts - Opcje komendy fetch (--df, --dt)
 * @param {TGlobalOpts} globalOpts - Opcje globalne CLI
 * @returns {Promise<void>}
 * @throws {Error} Gdy konfiguracja, daty lub eksport się nie powiedzie
 */
export async function fetchCmd(opts: TFetchOpts, globalOpts: TGlobalOpts): Promise<void> {
  const config = loadConfig(globalOpts);
  validateNIP(config.nip);

  logger.debug(`Katalog XML: ${config.xmlDir}`);

  const dateRange = resolveDateRange(opts);

  const loginResult = await authenticate(config);

  logger.info('');
  logger.info('=== POBIERANIE FAKTUR XML ===');
  const exportResult = await runSingleExport({
    config,
    accessToken: loginResult.accessToken,
    dateRange,
    outputDir: config.xmlDir,
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
}
