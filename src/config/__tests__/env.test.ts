import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types.ts';
import { getApiUrl, getConfig, validateConfig } from '../env.ts';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

// Zapobiegamy wczytywaniu pliku .env w module
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

// existsSync używane w validateConfig do sprawdzenia wymaganych plików
const mockExistsSync = vi.hoisted(() => vi.fn().mockReturnValue(true));
vi.mock('fs', () => ({
  existsSync: mockExistsSync,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// --------------------------------------------------------------------------
// Stałe testowe
// --------------------------------------------------------------------------

const VALID_CONFIG = Object.freeze<IConfig>({
  env: 'TEST',
  baseUrl: 'https://api-test.ksef.mf.gov.pl',
  certPath: '/certs/test.crt',
  certKeyPath: '/certs/test.key',
  certPassword: '',
  tokenPath: '/tokens/ksef.token',
  publicKeyPath: '/certs/public-key.pem',
  nip: '5252674798', // poprawna suma kontrolna NIP
  outputDir: '/output',
  tempDir: '/tmp',
  templatePath: null,
  tokenStoragePath: '/tokens/ksef-tokens.json',
  tokenRefreshMarginMinutes: 5,
  exportPollIntervalSeconds: 5,
  exportStatusMaxWaitMinutes: 10,
  libreOfficePath: null,
});

// --------------------------------------------------------------------------
// getApiUrl
// --------------------------------------------------------------------------

describe('getApiUrl', () => {
  it('powinien zwrócić URL dla środowiska DEMO', () => {
    expect(getApiUrl('DEMO')).toBe('https://api-demo.ksef.mf.gov.pl');
  });

  it('powinien zwrócić URL dla środowiska TEST', () => {
    expect(getApiUrl('TEST')).toBe('https://api-test.ksef.mf.gov.pl');
  });

  it('powinien zwrócić URL dla środowiska PRD', () => {
    expect(getApiUrl('PRD')).toBe('https://api.ksef.mf.gov.pl');
  });
});

// --------------------------------------------------------------------------
// getConfig
// --------------------------------------------------------------------------

describe('getConfig', () => {
  it('powinien zwrócić poprawny IConfig gdy KSEF_ENV i NIP są ustawione', () => {
    vi.stubEnv('KSEF_ENV', 'TEST');
    vi.stubEnv('NIP', '5252674798');

    const result = getConfig();

    expect(result.env).toBe('TEST');
    expect(result.baseUrl).toBe('https://api-test.ksef.mf.gov.pl');
    expect(result.nip).toBe('5252674798');
  });

  it('powinien rzucić błąd gdy KSEF_ENV nie jest ustawiony', () => {
    vi.stubEnv('KSEF_ENV', '');

    expect(() => getConfig()).toThrow('KSEF_ENV jest wymagany');
  });

  it('powinien rzucić błąd gdy KSEF_ENV ma nieprawidłową wartość', () => {
    vi.stubEnv('KSEF_ENV', 'STAGING');

    expect(() => getConfig()).toThrow('KSEF_ENV musi być jednym z: DEMO, TEST, PRD');
  });

  it('powinien użyć wartości domyślnych gdy opcjonalne zmienne środowiskowe nie są ustawione', () => {
    vi.stubEnv('KSEF_ENV', 'PRD');
    vi.stubEnv('CERT_PATH', '');
    vi.stubEnv('TOKEN_REFRESH_MARGIN_MINUTES', '');
    vi.stubEnv('LIBREOFFICE_PATH', '');

    const result = getConfig();

    expect(result.certPath).toBe('./certs/ksef.crt');
    expect(result.tokenRefreshMarginMinutes).toBe(5);
    expect(result.libreOfficePath).toBeNull();
  });
});

// --------------------------------------------------------------------------
// validateConfig
// --------------------------------------------------------------------------

describe('validateConfig', () => {
  it('powinien zwrócić true dla poprawnej konfiguracji', () => {
    expect(validateConfig(VALID_CONFIG)).toBe(true);
  });

  it('powinien rzucić błąd gdy ścieżka certyfikatu zawiera path traversal (../)', () => {
    const config = { ...VALID_CONFIG, certPath: '../secret/cert.crt' };

    expect(() => validateConfig(config)).toThrow('Błędy walidacji konfiguracji');
  });

  it('powinien rzucić błąd gdy NIP jest pusty', () => {
    const config = { ...VALID_CONFIG, nip: '' };

    expect(() => validateConfig(config)).toThrow('NIP jest wymagany');
  });

  it('powinien rzucić błąd gdy TOKEN_REFRESH_MARGIN_MINUTES jest poza zakresem 0-60', () => {
    const config = { ...VALID_CONFIG, tokenRefreshMarginMinutes: 100 };

    expect(() => validateConfig(config)).toThrow('TOKEN_REFRESH_MARGIN_MINUTES musi być w zakresie 0-60');
  });

  it('powinien rzucić błąd gdy EXPORT_POLL_INTERVAL_SECONDS jest poza zakresem 1-300', () => {
    const config = { ...VALID_CONFIG, exportPollIntervalSeconds: 0 };

    expect(() => validateConfig(config)).toThrow('EXPORT_POLL_INTERVAL_SECONDS musi być w zakresie 1-300');
  });

  it('powinien rzucić błąd gdy plik tokenPath nie istnieje na dysku', () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => validateConfig(VALID_CONFIG)).toThrow('Wymagany plik nie istnieje');
  });
});
