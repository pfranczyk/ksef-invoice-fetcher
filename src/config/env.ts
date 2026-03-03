/**
 * Wczytywanie konfiguracji z pliku .env
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { IConfig, TApiUrls, TEnvironment } from '../types.ts';
import { validateNIP, validatePath, validateURL } from '../utils/validator.ts';

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = dirname(__filename);

// Wczytaj .env z katalogu głównego projektu
config({ path: resolve(__dirname, '../../.env'), debug: false });

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
 * Pobiera konfigurację aplikacji z zmiennych środowiskowych
 * @returns {IConfig} Obiekt konfiguracji
 * @throws {Error} Jeśli KSEF_ENV nie jest ustawiony
 */
export function getConfig(): IConfig {
  const envValue: string | undefined = process.env.KSEF_ENV;

  if (!envValue) {
    throw new Error('KSEF_ENV jest wymagany. Ustaw zmienną środowiskową KSEF_ENV na jedną z wartości: DEMO, TEST, PRD');
  }

  if (!['DEMO', 'TEST', 'PRD'].includes(envValue)) {
    throw new Error(`KSEF_ENV musi być jednym z: DEMO, TEST, PRD (otrzymano: ${envValue})`);
  }

  const env: TEnvironment = envValue as TEnvironment;

  return {
    // Środowisko KSeF
    env,
    baseUrl: API_URLS[env],

    // Ścieżki certyfikatów i tokenów
    certPath: process.env.CERT_PATH || './certs/ksef.crt',
    certKeyPath: process.env.CERT_KEY_PATH || './certs/ksef.key',
    certPassword: process.env.CERT_PASSWORD || '',
    tokenPath: process.env.TOKEN_PATH || './certs/ksef.token',

    // Klucz publiczny KSeF
    publicKeyPath: process.env.KSEF_PUBLIC_KEY_PATH || './certs/ksef-public.pem',

    // NIP
    nip: process.env.NIP || '',

    // Katalogi
    outputDir: process.env.OUTPUT_DIR || './output',
    tempDir: process.env.TEMP_DIR || './tmp',

    // Szablon DOCX
    templatePath: process.env.TEMPLATE_DOCX || null,

    // Przechowywanie tokenów
    tokenStoragePath: process.env.TOKEN_STORAGE_PATH || './tokens/ksef-tokens.json',
    tokenRefreshMarginMinutes: parseInt(process.env.TOKEN_REFRESH_MARGIN_MINUTES || '5', 10) || 5,

    // Eksport faktur
    exportPollIntervalSeconds: parseInt(process.env.EXPORT_POLL_INTERVAL_SECONDS || '5', 10) || 5,
    exportStatusMaxWaitMinutes: parseInt(process.env.EXPORT_STATUS_MAX_WAIT_MINUTES || '0', 10) || 0,

    // LibreOffice - konwersja DOCX do PDF
    libreOfficePath: process.env.LIBREOFFICE_PATH || null,
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
 * Waliduje konfigurację aplikacji
 * Sprawdza czy wszystkie wymagane zmienne są ustawione i poprawne
 * @param {IConfig} config - Obiekt konfiguracji z getConfig()
 * @throws {Error} Jeśli konfiguracja jest niepoprawna
 * @returns {boolean} True jeśli konfiguracja jest poprawna
 */
export function validateConfig(config: IConfig): boolean {
  const errors: string[] = [];

  // Walidacja środowiska
  if (!VALID_ENVIRONMENTS.includes(config.env)) {
    errors.push(`KSEF_ENV musi być jednym z: DEMO, TEST, PRD (otrzymano: ${config.env})`);
  }

  // Walidacja URL
  try {
    validateURL(config.baseUrl, 'baseUrl');
  } catch (error) {
    errors.push((error as Error).message);
  }

  // Walidacja NIP (tylko jeśli ustawiony)
  if (config.nip) {
    try {
      validateNIP(config.nip);
    } catch (error) {
      errors.push(`NIP: ${(error as Error).message}`);
    }
  } else {
    errors.push('NIP jest wymagany (zmienna NIP lub --nip)');
  }

  // Walidacja ścieżek - sprawdzenie path traversal
  const pathsToValidate: Array<{ path: string; name: string }> = [
    { path: config.certPath, name: 'CERT_PATH' },
    { path: config.certKeyPath, name: 'CERT_KEY_PATH' },
    { path: config.tokenPath, name: 'TOKEN_PATH' },
    { path: config.publicKeyPath, name: 'KSEF_PUBLIC_KEY_PATH' },
    { path: config.outputDir, name: 'OUTPUT_DIR' },
    { path: config.tempDir, name: 'TEMP_DIR' },
    { path: config.tokenStoragePath, name: 'TOKEN_STORAGE_PATH' },
  ];

  for (const { path, name } of pathsToValidate) {
    try {
      validatePath(path, name);
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  // Walidacja istnienia krytycznych plików przy starcie
  const requiredFiles: Array<{ path: string; name: string }> = [
    { path: config.tokenPath, name: 'TOKEN_PATH (plik z tokenem KSeF)' },
  ];

  for (const { path, name } of requiredFiles) {
    if (!existsSync(path)) {
      errors.push(`Wymagany plik nie istnieje: ${name} (${path})`);
    }
  }

  // Walidacja zakresów liczbowych
  if (config.tokenRefreshMarginMinutes < 0 || config.tokenRefreshMarginMinutes > 60) {
    errors.push('TOKEN_REFRESH_MARGIN_MINUTES musi być w zakresie 0-60');
  }

  if (config.exportPollIntervalSeconds < 1 || config.exportPollIntervalSeconds > 300) {
    errors.push('EXPORT_POLL_INTERVAL_SECONDS musi być w zakresie 1-300');
  }

  if (config.exportStatusMaxWaitMinutes < 0) {
    errors.push('EXPORT_STATUS_MAX_WAIT_MINUTES nie może być ujemny');
  }

  // Jeśli są błędy, rzuć wyjątek
  if (errors.length > 0) {
    throw new Error(
      `Błędy walidacji konfiguracji:\n${errors.map((err: string, idx: number) => `  ${idx + 1}. ${err}`).join('\n')}`,
    );
  }

  return true;
}
