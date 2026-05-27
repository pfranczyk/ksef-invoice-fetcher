/**
 * Wspólna logika komend CLI: opcje globalne, wczytanie konfiguracji, autoryzacja KSeF.
 */
import { KSeFAuth, type TLoginReturn } from '@logrox/ksef-login';
import { deleteTokenFile, loadTokens, saveTokens } from '../auth/token-manager.ts';
import { getConfig, validateConfig } from '../config/env.ts';
import type { IConfig } from '../types.ts';
import { fileExists, readFile, writeFile } from '../utils/file-system.ts';
import logger, { maskSensitiveData } from '../utils/logger.ts';

/** Opcje globalne programu (Commander root) */
export type TGlobalOpts = {
  readonly verbose?: boolean;
};

/**
 * Stosuje globalne opcje CLI przed wczytaniem konfiguracji.
 * @param {TGlobalOpts} globalOpts - Opcje globalne z Commander
 * @returns {void}
 */
export function applyGlobalOpts(globalOpts: TGlobalOpts): void {
  if (globalOpts.verbose) {
    logger.level = 'debug';
  }
}

/**
 * Wypisuje blok ostrzeżenia o pracy na środowisku produkcyjnym KSeF.
 * @returns {void}
 */
export function logProductionWarning(): void {
  logger.warn('────────────────────────────────────────────────────────────');
  logger.warn('UWAGA: środowisko PRODUKCYJNE KSeF');
  logger.warn('Wszystkie operacje dotyczą faktur o skutkach prawnych');
  logger.warn('wynikających z ustawy o VAT.');
  logger.warn('────────────────────────────────────────────────────────────');
}

/**
 * Wczytuje token KSeF z pliku z przyjaznym komunikatem przy braku lub pustym pliku.
 * @param {IConfig} config - Konfiguracja aplikacji
 * @returns {Promise<string>} Treść tokenu (z usuniętymi znakami białymi)
 * @throws {Error} Gdy plik nie istnieje lub jest pusty
 */
async function loadKsefToken(config: IConfig): Promise<string> {
  if (!(await fileExists(config.tokenPath))) {
    throw new Error(
      `Brak pliku tokenu: ${config.tokenPath}\n` +
        `Uruchom \`ksef init <nip>\` lub utwórz ten plik z tokenem KSeF wygenerowanym w portalu KSeF dla środowiska ${config.env}.`,
    );
  }
  const content = (await readFile(config.tokenPath)).trim();
  if (content === '') {
    throw new Error(
      `Plik tokenu jest pusty: ${config.tokenPath}\n` +
        `Otwórz go i wklej token KSeF wygenerowany w portalu KSeF dla środowiska ${config.env}.`,
    );
  }
  return content;
}

/**
 * Wczytuje i waliduje konfigurację aplikacji z bieżącego katalogu roboczego.
 * @param {TGlobalOpts} globalOpts - Opcje globalne (override KSEF_ENV / verbose)
 * @returns {IConfig} Zwalidowana konfiguracja
 * @throws {Error} Gdy konfiguracja jest niekompletna lub niepoprawna
 */
export function loadConfig(globalOpts: TGlobalOpts): IConfig {
  applyGlobalOpts(globalOpts);

  const config = getConfig();
  validateConfig(config);

  logger.info('KSeF CLI');
  logger.info(`Środowisko: ${config.env}`);
  logger.info(`API URL: ${config.baseUrl}`);

  return config;
}

/**
 * Autoryzuje w KSeF: używa zapisanych tokenów (z odświeżeniem) lub pełnego
 * logowania tokenem KSeF. Zapisuje tokeny i opcjonalny klucz publiczny.
 * @param {IConfig} config - Konfiguracja aplikacji
 * @returns {Promise<TLoginReturn>} Wynik logowania (access/refresh token, opcjonalny klucz publiczny)
 * @throws {Error} Gdy autoryzacja się nie powiedzie
 */
export async function authenticate(config: IConfig): Promise<TLoginReturn> {
  logger.info('Sprawdzanie zapisanej sesji...');

  const ksefToken = await loadKsefToken(config);
  const cachedPublicKey = (await fileExists(config.publicKeyPath)) ? await readFile(config.publicKeyPath) : undefined;
  const tokenData = await loadTokens(config);

  const auth = new KSeFAuth({
    baseUrl: config.baseUrl,
    nip: config.nip,
    ksefToken,
    publicKey: cachedPublicKey,
    autoFetchPublicKey: !cachedPublicKey,
    logger,
  });

  let loginResult: TLoginReturn;
  try {
    loginResult = await auth.login({
      tokens: tokenData ? { accessToken: tokenData.accessToken, refreshToken: tokenData.refreshToken } : undefined,
    });
  } catch (err) {
    if (tokenData) {
      logger.warn(`Odświeżanie tokenu nie powiodło się: ${(err as Error).message}. Uruchamiam pełne logowanie...`);
      await deleteTokenFile(config);
      loginResult = await auth.login();
    } else {
      throw err;
    }
  }

  if (loginResult.publicKey) {
    await writeFile(config.publicKeyPath, loginResult.publicKey);
    logger.debug('Nowy klucz publiczny KSeF zapisany do pliku');
  }

  await saveTokens(loginResult.accessToken, loginResult.refreshToken, config);

  logger.info('✓ Pomyślnie zautoryzowano w KSeF');
  if (loginResult.accessToken) {
    logger.debug(`Token dostępu: ${maskSensitiveData(loginResult.accessToken)}`);
  }

  if (config.env === 'PRD') {
    logger.info('');
    logProductionWarning();
  }

  return loginResult;
}
