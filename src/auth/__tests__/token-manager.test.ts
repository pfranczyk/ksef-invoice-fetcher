import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types.ts';
import { decodeJwtPayload, getValidAccessToken, isAccessTokenValid, loadTokens, saveTokens } from '../token-manager.ts';

// --------------------------------------------------------------------------
// Stałe testowe
// --------------------------------------------------------------------------

const NOW_MS = 1767268800000; // 2026-01-01T12:00:00.000Z

const MOCK_CONFIG = Object.freeze<IConfig>({
  env: 'TEST',
  baseUrl: 'https://api-test.ksef.mf.gov.pl',
  certPath: '/certs/test.crt',
  certKeyPath: '/certs/test.key',
  certPassword: '',
  tokenPath: '/tokens/ksef.token',
  publicKeyPath: '/certs/public-key.pem',
  nip: '1234567890',
  outputDir: '/output',
  tempDir: '/tmp',
  templatePath: null,
  tokenStoragePath: '/tokens/ksef-tokens.json',
  tokenRefreshMarginMinutes: 2,
  exportPollIntervalSeconds: 5,
  exportStatusMaxWaitMinutes: 10,
  libreOfficePath: null,
});

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockFns = vi.hoisted(() => ({
  fileExists: vi.fn(),
  readJsonFile: vi.fn(),
  writeJsonFile: vi.fn(),
  deleteFile: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../../utils/file-system.ts', () => ({
  fileExists: mockFns.fileExists,
  readJsonFile: mockFns.readJsonFile,
  writeJsonFile: mockFns.writeJsonFile,
  deleteFile: mockFns.deleteFile,
}));

vi.mock('../../utils/http-client.ts', () => ({
  post: mockFns.post,
  TIMEOUTS: Object.freeze({
    DEFAULT: 30000,
    AUTH: 60000,
    EXPORT_INIT: 45000,
    EXPORT_STATUS: 30000,
    DOWNLOAD: 120000,
    PUBLIC_KEY: 20000,
  }),
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
    // '{"exp":1,"a":">>"}' — w standardowym Base64 sekwencja OiI+PiJ9 zawiera '+',
    // które base64url zastępuje '-'. Sprawdzamy czy dekoder obsługuje ten przypadek.
    const payloadJson = '{"exp":1,"a":">>"}';
    const b64url = Buffer.from(payloadJson).toString('base64url'); // zawiera '-' zamiast '+'
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
// isAccessTokenValid
// --------------------------------------------------------------------------

describe('isAccessTokenValid', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('powinien zwrócić true gdy token jest ważny (exp daleko w przyszłości)', () => {
    const jwt = makeJwt({ exp: Math.floor(NOW_MS / 1000) + 3600 });

    expect(isAccessTokenValid(jwt)).toBe(true);
  });

  it('powinien zwrócić false gdy token wygasł', () => {
    const jwt = makeJwt({ exp: Math.floor(NOW_MS / 1000) - 3600 });

    expect(isAccessTokenValid(jwt)).toBe(false);
  });

  it('powinien zwrócić false gdy token wygasa w ciągu domyślnego buforu 2 minut', () => {
    const jwt = makeJwt({ exp: Math.floor(NOW_MS / 1000) + 60 }); // +1m — w buforze 2-minutowym

    expect(isAccessTokenValid(jwt)).toBe(false);
  });

  it('powinien respektować niestandardowy bufferMinutes', () => {
    const jwt = makeJwt({ exp: Math.floor(NOW_MS / 1000) + 300 }); // +5m

    expect(isAccessTokenValid(jwt, 10)).toBe(false); // bufor 10m → token w buforze
    expect(isAccessTokenValid(jwt, 1)).toBe(true); // bufor 1m → token ważny
  });

  it('powinien zwrócić false gdy token jest nieprawidłowym JWT', () => {
    expect(isAccessTokenValid('nieprawidlowy-token')).toBe(false);
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
      nip: '9999999999', // inny NIP niż w MOCK_CONFIG
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
      environment: 'PRD', // inne środowisko niż TEST
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

// --------------------------------------------------------------------------
// getValidAccessToken
// --------------------------------------------------------------------------

describe('getValidAccessToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('powinien zwrócić null gdy brak pliku tokenów', async () => {
    mockFns.fileExists.mockResolvedValue(false);

    const result = await getValidAccessToken(MOCK_CONFIG);

    expect(result).toBeNull();
    expect(mockFns.post).not.toHaveBeenCalled();
  });

  it('powinien zwrócić tokeny z cache gdy accessToken jest ważny', async () => {
    const futureExp = Math.floor(NOW_MS / 1000) + 3600;
    const accessToken = makeJwt({ exp: futureExp });
    const refreshToken = makeJwt({ exp: futureExp });
    mockFns.fileExists.mockResolvedValue(true);
    mockFns.readJsonFile.mockResolvedValue({
      accessToken,
      refreshToken,
      nip: MOCK_CONFIG.nip,
      environment: MOCK_CONFIG.env,
      savedAt: NOW_MS,
      accessTokenExpiresAt: futureExp * 1000,
      refreshTokenExpiresAt: futureExp * 1000,
    });

    const result = await getValidAccessToken(MOCK_CONFIG);

    expect(result).toEqual({ accessToken, refreshToken });
    expect(mockFns.post).not.toHaveBeenCalled();
  });

  it('powinien odświeżyć tokeny gdy accessToken wygasł a refreshToken jest ważny', async () => {
    const pastExp = Math.floor(NOW_MS / 1000) - 3600;
    const futureExp = Math.floor(NOW_MS / 1000) + 3600;
    const newExp = Math.floor(NOW_MS / 1000) + 7200;

    const newAccessToken = makeJwt({ exp: newExp });
    const newRefreshToken = makeJwt({ exp: newExp });

    mockFns.fileExists.mockResolvedValue(true);
    mockFns.readJsonFile.mockResolvedValue({
      accessToken: makeJwt({ exp: pastExp }),
      refreshToken: makeJwt({ exp: futureExp }),
      nip: MOCK_CONFIG.nip,
      environment: MOCK_CONFIG.env,
      savedAt: NOW_MS,
      accessTokenExpiresAt: pastExp * 1000,
      refreshTokenExpiresAt: futureExp * 1000,
    });
    mockFns.post.mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: newAccessToken, refreshToken: newRefreshToken }),
    });
    mockFns.writeJsonFile.mockResolvedValue(undefined);

    const result = await getValidAccessToken(MOCK_CONFIG);

    expect(result).toEqual({ accessToken: newAccessToken, refreshToken: newRefreshToken });
    expect(mockFns.post).toHaveBeenCalledOnce();
    expect(mockFns.writeJsonFile).toHaveBeenCalledOnce();
  });

  it('powinien zwrócić null i usunąć plik gdy oba tokeny wygasły', async () => {
    const pastExp = Math.floor(NOW_MS / 1000) - 3600;
    mockFns.fileExists.mockResolvedValue(true);
    mockFns.readJsonFile.mockResolvedValue({
      accessToken: makeJwt({ exp: pastExp }),
      refreshToken: makeJwt({ exp: pastExp }),
      nip: MOCK_CONFIG.nip,
      environment: MOCK_CONFIG.env,
      savedAt: NOW_MS,
      accessTokenExpiresAt: pastExp * 1000,
      refreshTokenExpiresAt: pastExp * 1000,
    });

    const result = await getValidAccessToken(MOCK_CONFIG);

    expect(result).toBeNull();
    expect(mockFns.deleteFile).toHaveBeenCalledWith(MOCK_CONFIG.tokenStoragePath);
    expect(mockFns.post).not.toHaveBeenCalled();
  });
});
