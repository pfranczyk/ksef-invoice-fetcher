/**
 * Komenda `ksef login` — test autoryzacji w KSeF (bez eksportu faktur).
 */
import logger from '../utils/logger.ts';
import { validateNIP } from '../utils/validator.ts';
import { authenticate, loadConfig, type TGlobalOpts } from './_shared.ts';

/**
 * Handler komendy `login`: autoryzuje i zapisuje tokeny do przyszłego użycia.
 * @param {TGlobalOpts} globalOpts - Opcje globalne CLI
 * @returns {Promise<void>}
 * @throws {Error} Gdy konfiguracja lub autoryzacja się nie powiedzie
 */
export async function loginCmd(globalOpts: TGlobalOpts): Promise<void> {
  const config = loadConfig(globalOpts);
  validateNIP(config.nip);

  await authenticate(config);

  logger.info('');
  logger.info('=== TEST AUTORYZACJI ZAKOŃCZONY POMYŚLNIE ===');
  logger.info('Token zapisany do przyszłego użycia.');
  logger.info('Uruchom `ksef fetch --df <data>` aby pobrać faktury.');
}
