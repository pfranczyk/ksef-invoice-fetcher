/**
 * Komenda `ksef pdf [miesiąc]` — generowanie PDF z faktur XML danego miesiąca.
 */
import { generatePdfForMonth } from '../pdf/pdf-generator.ts';
import logger from '../utils/logger.ts';
import { loadConfig, type TGlobalOpts } from './_shared.ts';

/** Opcje komendy `pdf` */
export type TPdfOpts = {
  readonly startDay?: string;
  readonly endDay?: string;
};

/**
 * Zwraca poprzedni miesiąc kalendarzowy w formacie YYYY-MM.
 * @returns {string} Poprzedni miesiąc, np. "2026-01" gdy bieżący to luty 2026
 */
function getPreviousMonth(): string {
  const now = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Handler komendy `pdf`: generuje PDF dla faktur danego miesiąca.
 * @param {string | undefined} month - Miesiąc YYYY-MM; gdy pominięty → poprzedni miesiąc
 * @param {TPdfOpts} opts - Opcje komendy pdf
 * @param {TGlobalOpts} globalOpts - Opcje globalne CLI
 * @returns {Promise<void>}
 * @throws {Error} Gdy konfiguracja lub generowanie PDF się nie powiedzie
 */
export async function pdfCmd(month: string | undefined, opts: TPdfOpts, globalOpts: TGlobalOpts): Promise<void> {
  const config = loadConfig(globalOpts);

  logger.info('');
  logger.info('=== GENEROWANIE PDF ===');

  let pdfMonth: string;
  if (month) {
    pdfMonth = month;
  } else {
    pdfMonth = getPreviousMonth();
    logger.info(`Nie podano miesiąca, używam poprzedniego miesiąca: ${pdfMonth}`);
  }

  const stats = await generatePdfForMonth({
    month: pdfMonth,
    xmlDir: config.xmlDir,
    pdfDir: config.pdfDir,
    startDay: opts.startDay !== undefined ? parseInt(opts.startDay, 10) : undefined,
    endDay: opts.endDay !== undefined ? parseInt(opts.endDay, 10) : undefined,
  });

  process.exitCode = stats.failed > 0 ? 1 : 0;
}
