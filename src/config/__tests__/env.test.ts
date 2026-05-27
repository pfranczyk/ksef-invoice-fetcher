import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types.ts';
import {
  getApiUrl,
  getConfig,
  getKsefConfigPath,
  getKsefDir,
  type IKsefConfigFile,
  readKsefConfigFile,
  validateConfig,
  writeKsefConfigFile,
} from '../env.ts';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------
// Stałe testowe
// --------------------------------------------------------------------------

const VALID_CONFIG_FILE = Object.freeze<IKsefConfigFile>({
  nip: '5252674798',
  environment: 'TEST',
});

const VALID_CONFIG = Object.freeze<IConfig>({
  env: 'TEST',
  baseUrl: 'https://api-test.ksef.mf.gov.pl',
  tokenPath: '/.ksef/ksef.token',
  publicKeyPath: '/.ksef/public-key.pem',
  nip: '5252674798',
  xmlDir: '/xml',
  pdfDir: '/pdf',
  tempDir: '/.ksef/tmp',
  tokenStoragePath: '/.ksef/tokens.json',
  tokenRefreshMarginMinutes: 5,
  exportPollIntervalSeconds: 5,
  exportStatusMaxWaitMinutes: 10,
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
// getKsefDir / getKsefConfigPath
// --------------------------------------------------------------------------

describe('getKsefDir', () => {
  it('powinien zwrócić ścieżkę do .ksef/ w bieżącym katalogu roboczym', () => {
    expect(getKsefDir()).toBe(resolve(process.cwd(), '.ksef'));
  });
});

describe('getKsefConfigPath', () => {
  it('powinien zwrócić ścieżkę do .ksef/config.json', () => {
    expect(getKsefConfigPath()).toBe(resolve(process.cwd(), '.ksef', 'config.json'));
  });
});

// --------------------------------------------------------------------------
// readKsefConfigFile
// --------------------------------------------------------------------------

describe('readKsefConfigFile', () => {
  it('powinien zwrócić sparsowaną zawartość pliku gdy JSON jest poprawny', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CONFIG_FILE));

    expect(readKsefConfigFile()).toEqual(VALID_CONFIG_FILE);
  });

  it('powinien rzucić błąd gdy plik nie istnieje', () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => readKsefConfigFile()).toThrow('Brak konfiguracji KSeF');
  });

  it('powinien rzucić błąd gdy JSON jest niepoprawny', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{not json');

    expect(() => readKsefConfigFile()).toThrow('Niepoprawny JSON');
  });

  it('powinien rzucić błąd gdy brak pola "nip"', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ environment: 'TEST' }));

    expect(() => readKsefConfigFile()).toThrow('Brak pola "nip"');
  });

  it('powinien rzucić błąd gdy brak pola "environment"', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ nip: '5252674798' }));

    expect(() => readKsefConfigFile()).toThrow('Brak pola "environment"');
  });

  it('powinien rzucić błąd gdy wartość "environment" jest niepoprawna', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ nip: '5252674798', environment: 'STAGING' }));

    expect(() => readKsefConfigFile()).toThrow('Niepoprawna wartość "environment"');
  });
});

// --------------------------------------------------------------------------
// writeKsefConfigFile
// --------------------------------------------------------------------------

describe('writeKsefConfigFile', () => {
  it('powinien utworzyć katalog .ksef/ i zapisać plik z zawartością JSON', () => {
    writeKsefConfigFile(VALID_CONFIG_FILE);

    expect(mockMkdirSync).toHaveBeenCalledWith(resolve(process.cwd(), '.ksef'), { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      resolve(process.cwd(), '.ksef', 'config.json'),
      `${JSON.stringify(VALID_CONFIG_FILE, null, 2)}\n`,
      'utf-8',
    );
  });
});

// --------------------------------------------------------------------------
// getConfig
// --------------------------------------------------------------------------

describe('getConfig', () => {
  it('powinien zwrócić IConfig z domyślnymi parametrami numerycznymi', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CONFIG_FILE));

    const result = getConfig();

    expect(result.env).toBe('TEST');
    expect(result.baseUrl).toBe('https://api-test.ksef.mf.gov.pl');
    expect(result.nip).toBe('5252674798');
    expect(result.tokenRefreshMarginMinutes).toBe(5);
    expect(result.exportPollIntervalSeconds).toBe(5);
    expect(result.exportStatusMaxWaitMinutes).toBe(0);
    expect(result.tokenPath).toBe(resolve(process.cwd(), '.ksef', 'ksef.token'));
    expect(result.publicKeyPath).toBe(resolve(process.cwd(), '.ksef', 'public-key.pem'));
    expect(result.tokenStoragePath).toBe(resolve(process.cwd(), '.ksef', 'tokens.json'));
    expect(result.tempDir).toBe(resolve(process.cwd(), '.ksef', 'tmp'));
    expect(result.xmlDir).toBe(resolve(process.cwd(), 'xml'));
    expect(result.pdfDir).toBe(resolve(process.cwd(), 'pdf'));
  });

  it('powinien honorować parametry numeryczne nadpisane w pliku konfiguracyjnym', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        ...VALID_CONFIG_FILE,
        tokenRefreshMarginMinutes: 15,
        exportPollIntervalSeconds: 10,
        exportStatusMaxWaitMinutes: 30,
      }),
    );

    const result = getConfig();

    expect(result.tokenRefreshMarginMinutes).toBe(15);
    expect(result.exportPollIntervalSeconds).toBe(10);
    expect(result.exportStatusMaxWaitMinutes).toBe(30);
  });
});

// --------------------------------------------------------------------------
// validateConfig
// --------------------------------------------------------------------------

describe('validateConfig', () => {
  it('powinien zwrócić true dla poprawnej konfiguracji', () => {
    expect(validateConfig(VALID_CONFIG)).toBe(true);
  });

  it('powinien rzucić błąd gdy NIP jest pusty', () => {
    expect(() => validateConfig({ ...VALID_CONFIG, nip: '' })).toThrow('NIP jest wymagany');
  });

  it('powinien rzucić błąd gdy NIP ma błędną sumę kontrolną', () => {
    expect(() => validateConfig({ ...VALID_CONFIG, nip: '5252674799' })).toThrow('Nieprawidłowa suma kontrolna');
  });

  it('powinien rzucić błąd gdy ścieżka katalogu XML zawiera path traversal (../)', () => {
    expect(() => validateConfig({ ...VALID_CONFIG, xmlDir: '../secret' })).toThrow('Błędy walidacji');
  });

  it('powinien rzucić błąd gdy tokenRefreshMarginMinutes jest poza zakresem 0-60', () => {
    expect(() => validateConfig({ ...VALID_CONFIG, tokenRefreshMarginMinutes: 100 })).toThrow(
      'tokenRefreshMarginMinutes musi być w zakresie 0-60',
    );
  });

  it('powinien rzucić błąd gdy exportPollIntervalSeconds jest poza zakresem 1-300', () => {
    expect(() => validateConfig({ ...VALID_CONFIG, exportPollIntervalSeconds: 0 })).toThrow(
      'exportPollIntervalSeconds musi być w zakresie 1-300',
    );
  });

  it('powinien rzucić błąd gdy exportStatusMaxWaitMinutes jest ujemny', () => {
    expect(() => validateConfig({ ...VALID_CONFIG, exportStatusMaxWaitMinutes: -1 })).toThrow(
      'exportStatusMaxWaitMinutes nie może być ujemny',
    );
  });
});
