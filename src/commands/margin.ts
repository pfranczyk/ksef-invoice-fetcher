/**
 * Komenda `ksef margin [minuty]` — pokazuje lub ustawia `tokenRefreshMarginMinutes`
 * w pliku `.ksef/config.json`.
 */
import { CONFIG_DEFAULTS, readKsefConfigFile, writeKsefConfigFile } from '../config/env.ts';
import logger from '../utils/logger.ts';

const MIN_MINUTES = 0;
const MAX_MINUTES = 60;

/**
 * Handler komendy `margin`: bez argumentu wypisuje aktualną wartość,
 * z argumentem ustawia ją w `.ksef/config.json`.
 * @param {string | undefined} value - Wartość w minutach (0-60) lub undefined dla odczytu
 * @returns {Promise<void>}
 * @throws {Error} Gdy wartość jest poza zakresem lub nie jest liczbą całkowitą
 */
export async function marginCmd(value?: string): Promise<void> {
  const config = readKsefConfigFile();

  if (value === undefined) {
    const current = config.tokenRefreshMarginMinutes ?? CONFIG_DEFAULTS.TOKEN_REFRESH_MARGIN_MINUTES;
    logger.info(`tokenRefreshMarginMinutes: ${current} min`);
    return;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_MINUTES || parsed > MAX_MINUTES) {
    throw new Error(
      `Niepoprawna wartość: "${value}". Wymagane: liczba całkowita w zakresie ${MIN_MINUTES}-${MAX_MINUTES}.`,
    );
  }

  writeKsefConfigFile({ ...config, tokenRefreshMarginMinutes: parsed });
  logger.info(`✓ Zapisano tokenRefreshMarginMinutes: ${parsed} min`);
}
