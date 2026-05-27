/**
 * Komenda `ksef interval [sekundy]` — pokazuje lub ustawia `exportPollIntervalSeconds`
 * w pliku `.ksef/config.json`.
 */
import { CONFIG_DEFAULTS, readKsefConfigFile, writeKsefConfigFile } from '../config/env.ts';
import logger from '../utils/logger.ts';

const MIN_SECONDS = 1;
const MAX_SECONDS = 300;

/**
 * Handler komendy `interval`: bez argumentu wypisuje aktualną wartość,
 * z argumentem ustawia ją w `.ksef/config.json`.
 * @param {string | undefined} value - Wartość w sekundach (1-300) lub undefined dla odczytu
 * @returns {Promise<void>}
 * @throws {Error} Gdy wartość jest poza zakresem lub nie jest liczbą całkowitą
 */
export async function intervalCmd(value?: string): Promise<void> {
  const config = readKsefConfigFile();

  if (value === undefined) {
    const current = config.exportPollIntervalSeconds ?? CONFIG_DEFAULTS.EXPORT_POLL_INTERVAL_SECONDS;
    logger.info(`exportPollIntervalSeconds: ${current} s`);
    return;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_SECONDS || parsed > MAX_SECONDS) {
    throw new Error(
      `Niepoprawna wartość: "${value}". Wymagane: liczba całkowita w zakresie ${MIN_SECONDS}-${MAX_SECONDS}.`,
    );
  }

  writeKsefConfigFile({ ...config, exportPollIntervalSeconds: parsed });
  logger.info(`✓ Zapisano exportPollIntervalSeconds: ${parsed} s`);
}
