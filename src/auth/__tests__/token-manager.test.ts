import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types.ts';
import { decodeJwtPayload, loadTokens, saveTokens } from '../token-manager.ts';

// --------------------------------------------------------------------------
// Stałe testowe
// --------------------------------------------------------------------------

const NOW_MS = 1767268800000; // 2026-01-01T12:00:00.000Z

const MOCK_CONFIG = Object.freeze<IConfig>({
  env: 'TEST',
  baseUrl: 'https://api-test.ksef.mf.gov.pl',
  tokenPath: '/.ksef/ksef.token',
  publicKeyPath: '/.ksef/public-key.pem',
  nip: '1234567890',
  xmlDir: '/xml',
  pdfDir: '/pdf',
  tempDir: '/.ksef/tmp',
  tokenStoragePath: '/.ksef/tokens.json',
  tokenRefreshMarginMinutes: 2,
  exportPollIntervalSeconds: 5,
  exportStatusMaxWaitMinutes: 10,
});

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockFns = vi.hoisted(() => ({
  fileExists: vi.fn(),
  readJsonFile: vi.fn(),
  writeJsonFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock('../../utils/file-system.ts', () => ({
  fileExists: mockFns.fileExists,
  readJsonFile: mockFns.readJsonFile,
  writeJsonFile: mockFns.writeJsonFile,
  deleteFile: mockFns.deleteFile,
}));

vi.mock('../../utils/logger.ts', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  maskSensitiveData: vi.fn((s: string) => s),
}));

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from('{"alg":"RS256","typ":"JWT"}').toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------
// decodeJwtPayload
// --------------------------------------------------------------------------

describe('decodeJwtPayload', () => {
  it('powinien zdekodować payload poprawnego tokenu JWT', () => {
    const jwt = makeJwt({ exp: 1700000000, sub: 'test' });

    const result = decodeJwtPayload(jwt);

    expect(result.exp).toBe(1700000000);
  });

  it('powinien poprawnie zdekodować payload z kodowaniem base64url (znaki - i _)', () => {
    const payloadJson = '{"exp":1,"a":">>"}';
    const b64url = Buffer.from(payloadJson).toString('base64url');
    const jwt = `fakehead.${b64url}.fakesig`;

    const result = decodeJwtPayload(jwt);

    expect(result.exp).toBe(1);
  });

  it('powinien rzucić błąd gdy token nie ma 3 części oddzielonych kropką', () => {
    expect(() => decodeJwtPayload('tylko-jedna-czesc')).toThrow('Failed to decode JWT');
  });

  it('powinien rzucić błąd gdy payload nie jest poprawnym JSON', () => {
    const header = Buffer.from('{}').toString('base64url');
    const invalidPayload = Buffer.from('to-nie-jest-json!!!').toString('base64url');
    const jwt = `${header}.${invalidPayload}.sig`;

    expect(() => decodeJwtPayload(jwt)).toThrow('Failed to decode JWT');
  });
});

// --------------------------------------------------------------------------
// loadTokens
// --------------------------------------------------------------------------

describe('loadTokens', () => {
  it('powinien zwrócić null gdy plik tokenów nie istnieje', async () => {
    mockFns.fileExists.mockResolvedValue(false);

    const result = await loadTokens(MOCK_CONFIG);

    expect(result).toBeNull();
    expect(mockFns.deleteFile).not.toHaveBeenCalled();
  });

  it('powinien zwrócić null i usunąć plik gdy NIP w pliku różni się od konfiguracji', async () => {
    mockFns.fileExists.mockResolvedValue(true);
    mockFns.readJsonFile.mockResolvedValue({
      accessToken: makeJwt({ exp: 9999999999 }),
      refreshToken: makeJwt({ exp: 9999999999 }),
      nip: '9999999999',
      environment: 'TEST',
      savedAt: NOW_MS,
      accessTokenExpiresAt: 9999999999000,
      refreshTokenExpiresAt: 9999999999000,
    });

    const result = await loadTokens(MOCK_CONFIG);

    expect(result).toBeNull();
    expect(mockFns.deleteFile).toHaveBeenCalledWith(MOCK_CONFIG.tokenStoragePath);
  });

  it('powinien zwrócić null i usunąć plik gdy środowisko w pliku różni się od konfiguracji', async () => {
    mockFns.fileExists.mockResolvedValue(true);
    mockFns.readJsonFile.mockResolvedValue({
      accessToken: makeJwt({ exp: 9999999999 }),
      refreshToken: makeJwt({ exp: 9999999999 }),
      nip: MOCK_CONFIG.nip,
      environment: 'PRD',
      savedAt: NOW_MS,
      accessTokenExpiresAt: 9999999999000,
      refreshTokenExpiresAt: 9999999999000,
    });

    const result = await loadTokens(MOCK_CONFIG);

    expect(result).toBeNull();
    expect(mockFns.deleteFile).toHaveBeenCalledWith(MOCK_CONFIG.tokenStoragePath);
  });

  it('powinien zwrócić dane tokenów gdy plik jest poprawny', async () => {
    const accessToken = makeJwt({ exp: 9999999999 });
    const refreshToken = makeJwt({ exp: 9999999999 });
    const tokenData = {
      accessToken,
      refreshToken,
      nip: MOCK_CONFIG.nip,
      environment: MOCK_CONFIG.env,
      savedAt: NOW_MS,
      accessTokenExpiresAt: 9999999999000,
      refreshTokenExpiresAt: 9999999999000,
    };
    mockFns.fileExists.mockResolvedValue(true);
    mockFns.readJsonFile.mockResolvedValue(tokenData);

    const result = await loadTokens(MOCK_CONFIG);

    expect(result).toEqual(tokenData);
    expect(mockFns.deleteFile).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// saveTokens
// --------------------------------------------------------------------------

describe('saveTokens', () => {
  it('powinien zapisać tokeny do pliku z trybem 0o600', async () => {
    const expSec = 9999999999;
    const accessToken = makeJwt({ exp: expSec });
    const refreshToken = makeJwt({ exp: expSec });
    mockFns.writeJsonFile.mockResolvedValue(undefined);

    await saveTokens(accessToken, refreshToken, MOCK_CONFIG);

    expect(mockFns.writeJsonFile).toHaveBeenCalledWith(
      MOCK_CONFIG.tokenStoragePath,
      expect.objectContaining({
        accessToken,
        refreshToken,
        nip: MOCK_CONFIG.nip,
        environment: MOCK_CONFIG.env,
        accessTokenExpiresAt: expSec * 1000,
        refreshTokenExpiresAt: expSec * 1000,
      }),
      0o600,
    );
  });

  it('powinien zapisać pole savedAt z bieżącym czasem', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    mockFns.writeJsonFile.mockResolvedValue(undefined);

    const expSec = 9999999999;
    await saveTokens(makeJwt({ exp: expSec }), makeJwt({ exp: expSec }), MOCK_CONFIG);

    const savedData = mockFns.writeJsonFile.mock.calls[0][1] as Record<string, unknown>;
    expect(savedData.savedAt).toBe(NOW_MS);

    vi.useRealTimers();
  });
});
