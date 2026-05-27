/**
 * Wczytywanie konfiguracji z pliku `.ksef/config.json` w bieżącym katalogu roboczym.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IConfig, TApiUrls, TEnvironment } from '../types.ts';
import { validateNIP, validatePath, validateURL } from '../utils/validator.ts';

/**
 * Dozwolone wartości środowiska KSeF
 */
const VALID_ENVIRONMENTS = Object.freeze<readonly TEnvironment[]>(['DEMO', 'TEST', 'PRD']);

/**
 * Bazowe URL-e API dla różnych środowisk KSeF
 */
const API_URLS = Object.freeze<TApiUrls>({
  DEMO: 'https://api-demo.ksef.mf.gov.pl',
  TEST: 'https://api-test.ksef.mf.gov.pl',
  PRD: 'https://api.ksef.mf.gov.pl',
});

/**
 * Domyślne wartości pól numerycznych w `.ksef/config.json` (gdy pominięte).
 */
type TConfigDefaults = {
  readonly TOKEN_REFRESH_MARGIN_MINUTES: number;
  readonly EXPORT_POLL_INTERVAL_SECONDS: number;
  readonly EXPORT_STATUS_MAX_WAIT_MINUTES: number;
};

export const CONFIG_DEFAULTS = Object.freeze<TConfigDefaults>({
  TOKEN_REFRESH_MARGIN_MINUTES: 5,
  EXPORT_POLL_INTERVAL_SECONDS: 5,
  EXPORT_STATUS_MAX_WAIT_MINUTES: 0,
});

/**
 * Struktura pliku `.ksef/config.json`
 */
export interface IKsefConfigFile {
  nip: string;
  environment: TEnvironment;
  tokenRefreshMarginMinutes?: number;
  exportPollIntervalSeconds?: number;
  exportStatusMaxWaitMinutes?: number;
}

/**
 * Zwraca ścieżkę do katalogu `.ksef/` w bieżącym katalogu roboczym.
 * @returns {string} Absolutna ścieżka do `<cwd>/.ksef`
 */
export function getKsefDir(): string {
  return resolve(process.cwd(), '.ksef');
}

/**
 * Zwraca ścieżkę do pliku konfiguracyjnego `.ksef/config.json`.
 * @returns {string} Absolutna ścieżka do pliku
 */
export function getKsefConfigPath(): string {
  return resolve(getKsefDir(), 'config.json');
}

/**
 * Wczytuje i waliduje surową zawartość `.ksef/config.json`.
 * @returns {IKsefConfigFile} Sparsowana zawartość pliku konfiguracyjnego
 * @throws {Error} Gdy brak pliku, niepoprawny JSON lub brakujące/niepoprawne wymagane pola
 */
export function readKsefConfigFile(): IKsefConfigFile {
  const configPath = getKsefConfigPath();

  if (!existsSync(configPath)) {
    throw new Error('Brak konfiguracji KSeF w bieżącym katalogu. Uruchom `ksef init <nip> [env]` aby ją utworzyć.');
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (error) {
    throw new Error(`Nie udało się odczytać ${configPath}: ${(error as Error).message}`);
  }

  let parsed: IKsefConfigFile;
  try {
    parsed = JSON.parse(raw) as IKsefConfigFile;
  } catch (error) {
    throw new Error(`Niepoprawny JSON w ${configPath}: ${(error as Error).message}`);
  }

  if (!parsed.nip) {
    throw new Error(`Brak pola "nip" w ${configPath}. Uruchom ponownie \`ksef init <nip>\`.`);
  }

  if (!parsed.environment) {
    throw new Error(`Brak pola "environment" w ${configPath}. Dozwolone: DEMO, TEST, PRD.`);
  }

  if (!VALID_ENVIRONMENTS.includes(parsed.environment)) {
    throw new Error(
      `Niepoprawna wartość "environment" w ${configPath}: ${parsed.environment}. Dozwolone: DEMO, TEST, PRD.`,
    );
  }

  return parsed;
}

/**
 * Zapisuje obiekt konfiguracji do `.ksef/config.json`. Tworzy katalog `.ksef/` jeśli nie istnieje.
 * @param {IKsefConfigFile} data - Zawartość pliku konfiguracyjnego
 * @throws {Error} Gdy nie udało się utworzyć katalogu lub zapisać pliku
 */
export function writeKsefConfigFile(data: IKsefConfigFile): void {
  const ksefDir = getKsefDir();
  mkdirSync(ksefDir, { recursive: true });
  const content = `${JSON.stringify(data, null, 2)}\n`;
  writeFileSync(getKsefConfigPath(), content, 'utf-8');
}

/**
 * Pobiera konfigurację aplikacji z pliku `.ksef/config.json` i rozwija ją do pełnego IConfig.
 * @returns {IConfig} Obiekt konfiguracji
 * @throws {Error} Gdy brak pliku konfiguracyjnego, niepoprawny JSON lub brakujące wymagane pola.
 */
export function getConfig(): IConfig {
  const parsed = readKsefConfigFile();
  const env: TEnvironment = parsed.environment;
  const ksefDir = getKsefDir();

  return {
    env,
    baseUrl: API_URLS[env],

    tokenPath: resolve(ksefDir, 'ksef.token'),
    publicKeyPath: resolve(ksefDir, 'public-key.pem'),
    tokenStoragePath: resolve(ksefDir, 'tokens.json'),
    tempDir: resolve(ksefDir, 'tmp'),

    nip: parsed.nip,

    xmlDir: resolve(process.cwd(), 'xml'),
    pdfDir: resolve(process.cwd(), 'pdf'),

    tokenRefreshMarginMinutes: parsed.tokenRefreshMarginMinutes ?? CONFIG_DEFAULTS.TOKEN_REFRESH_MARGIN_MINUTES,
    exportPollIntervalSeconds: parsed.exportPollIntervalSeconds ?? CONFIG_DEFAULTS.EXPORT_POLL_INTERVAL_SECONDS,
    exportStatusMaxWaitMinutes: parsed.exportStatusMaxWaitMinutes ?? CONFIG_DEFAULTS.EXPORT_STATUS_MAX_WAIT_MINUTES,
  };
}

/**
 * Zwraca bazowy URL API dla podanego środowiska
 * @param {TEnvironment} env - Środowisko (DEMO, TEST, PRD)
 * @returns {string} URL bazowy API
 */
export function getApiUrl(env: TEnvironment): string {
  return API_URLS[env];
}

/**
 * Waliduje konfigurację aplikacji: środowisko, URL, NIP, ścieżki (path traversal) oraz zakresy parametrów.
 * @param {IConfig} config - Obiekt konfiguracji z getConfig()
 * @returns {boolean} True jeśli konfiguracja jest poprawna
 * @throws {Error} Gdy konfiguracja jest niepoprawna
 */
export function validateConfig(config: IConfig): boolean {
  const errors: string[] = [];

  if (!VALID_ENVIRONMENTS.includes(config.env)) {
    errors.push(`environment musi być jednym z: DEMO, TEST, PRD (otrzymano: ${config.env})`);
  }

  try {
    validateURL(config.baseUrl, 'baseUrl');
  } catch (error) {
    errors.push((error as Error).message);
  }

  if (config.nip) {
    try {
      validateNIP(config.nip);
    } catch (error) {
      errors.push(`NIP: ${(error as Error).message}`);
    }
  } else {
    errors.push('NIP jest wymagany w .ksef/config.json');
  }

  const pathsToValidate: Array<{ path: string; name: string }> = [
    { path: config.tokenPath, name: 'tokenPath' },
    { path: config.publicKeyPath, name: 'publicKeyPath' },
    { path: config.xmlDir, name: 'xmlDir' },
    { path: config.pdfDir, name: 'pdfDir' },
    { path: config.tempDir, name: 'tempDir' },
    { path: config.tokenStoragePath, name: 'tokenStoragePath' },
  ];

  for (const { path, name } of pathsToValidate) {
    try {
      validatePath(path, name);
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  if (config.tokenRefreshMarginMinutes < 0 || config.tokenRefreshMarginMinutes > 60) {
    errors.push('tokenRefreshMarginMinutes musi być w zakresie 0-60');
  }

  if (config.exportPollIntervalSeconds < 1 || config.exportPollIntervalSeconds > 300) {
    errors.push('exportPollIntervalSeconds musi być w zakresie 1-300');
  }

  if (config.exportStatusMaxWaitMinutes < 0) {
    errors.push('exportStatusMaxWaitMinutes nie może być ujemny');
  }

  if (errors.length > 0) {
    throw new Error(
      `Błędy walidacji konfiguracji:\n${errors.map((err: string, idx: number) => `  ${idx + 1}. ${err}`).join('\n')}`,
    );
  }

  return true;
}
