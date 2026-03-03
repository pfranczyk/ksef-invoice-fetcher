import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types.ts';
import { authenticate, loadKsefToken, pollAuthStatus, redeemToken, submitKsefTokenAuth } from '../ksef-token-auth.ts';

// --------------------------------------------------------------------------
// Stałe testowe
// --------------------------------------------------------------------------

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
  readFile: vi.fn(),
  post: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
  getPublicKey: vi.fn(),
  getChallenge: vi.fn(),
  encryptKsefToken: vi.fn(),
}));

vi.mock('../../utils/file-system.ts', () => ({
  readFile: mockFns.readFile,
}));

vi.mock('../../utils/http-client.ts', () => ({
  post: mockFns.post,
  TIMEOUTS: Object.freeze({ DEFAULT: 30000, AUTH: 60000 }),
}));

vi.mock('../../utils/sleep.ts', () => ({
  sleep: mockFns.sleep,
}));

vi.mock('../../utils/logger.ts', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  maskSensitiveData: vi.fn((s: string) => s),
}));

vi.mock('../public-key.ts', () => ({
  getPublicKey: mockFns.getPublicKey,
}));

vi.mock('../challenge.ts', () => ({
  getChallenge: mockFns.getChallenge,
}));

vi.mock('../crypto.ts', () => ({
  encryptKsefToken: mockFns.encryptKsefToken,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  mockFns.sleep.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --------------------------------------------------------------------------
// loadKsefToken
// --------------------------------------------------------------------------

describe('loadKsefToken', () => {
  it('powinien wczytać token z pliku i usunąć białe znaki', async () => {
    mockFns.readFile.mockResolvedValue('  TOKEN-KSEF-123  \n');

    const result = await loadKsefToken('/tokens/ksef.token');

    expect(result).toBe('TOKEN-KSEF-123');
    expect(mockFns.readFile).toHaveBeenCalledWith('/tokens/ksef.token');
  });
});

// --------------------------------------------------------------------------
// submitKsefTokenAuth
// --------------------------------------------------------------------------

describe('submitKsefTokenAuth', () => {
  it('powinien wysłać POST z poprawnym body i zwrócić authenticationToken i referenceNumber', async () => {
    const authToken = { token: 'auth-tok-xyz', validUntil: '2030-01-01' };
    mockFns.post.mockResolvedValue({
      ok: true,
      json: async () => ({ authenticationToken: authToken, referenceNumber: 'REF-001' }),
    });

    const result = await submitKsefTokenAuth(
      { challenge: 'chall-abc', encryptedToken: 'enc-tok', nip: '1234567890' },
      'https://api-test.ksef.mf.gov.pl',
    );

    expect(result).toEqual({ authenticationToken: authToken, referenceNumber: 'REF-001' });
    expect(mockFns.post).toHaveBeenCalledWith('https://api-test.ksef.mf.gov.pl/v2/auth/ksef-token', {
      challenge: 'chall-abc',
      contextIdentifier: { type: 'Nip', value: '1234567890' },
      encryptedToken: 'enc-tok',
    });
  });

  it('powinien rzucić błąd gdy API zwraca HTTP błąd', async () => {
    mockFns.post.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(
      submitKsefTokenAuth(
        { challenge: 'x', encryptedToken: 'y', nip: '1234567890' },
        'https://api-test.ksef.mf.gov.pl',
      ),
    ).rejects.toThrow('KSeF token auth failed: HTTP 401 - Unauthorized');
  });
});

// --------------------------------------------------------------------------
// pollAuthStatus
// --------------------------------------------------------------------------

describe('pollAuthStatus', () => {
  it('powinien zwrócić status gdy odpowiedź ma kod 200', async () => {
    const successStatus = { status: { code: 200 } };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(successStatus), { status: 200 }));

    const result = await pollAuthStatus('REF-001', 'auth-tok', 'https://api-test.ksef.mf.gov.pl', {
      intervalMs: 10,
    });

    expect(result).toEqual(successStatus);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('powinien ponawiać odpytywanie aż do uzyskania kodu 200', async () => {
    const pending = { status: { code: 100 } };
    const success = { status: { code: 200 } };
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(pending), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pending), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(success), { status: 200 }));

    const result = await pollAuthStatus('REF-001', 'auth-tok', 'https://api-test.ksef.mf.gov.pl', {
      intervalMs: 10,
    });

    expect(result).toEqual(success);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(mockFns.sleep).toHaveBeenCalledTimes(2);
    expect(mockFns.sleep).toHaveBeenCalledWith(10);
  });

  it('powinien rzucić błąd gdy status wskazuje błąd autentykacji (kod >= 400)', async () => {
    const errorStatus = {
      status: { code: 400 },
      processingCode: 400,
      processingDescription: 'Nieprawidłowy token',
    };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(errorStatus), { status: 200 }));

    await expect(
      pollAuthStatus('REF-001', 'auth-tok', 'https://api-test.ksef.mf.gov.pl', { intervalMs: 10 }),
    ).rejects.toThrow('Authentication failed with code 400');
  });
});

// --------------------------------------------------------------------------
// redeemToken
// --------------------------------------------------------------------------

describe('redeemToken', () => {
  it('powinien zwrócić accessToken i refreshToken gdy API zwraca stringi', async () => {
    mockFns.post.mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'acc-tok', refreshToken: 'ref-tok' }),
    });

    const result = await redeemToken('auth-token', 'https://api-test.ksef.mf.gov.pl');

    expect(result).toEqual({ accessToken: 'acc-tok', refreshToken: 'ref-tok' });
    expect(mockFns.post).toHaveBeenCalledWith(
      'https://api-test.ksef.mf.gov.pl/v2/auth/token/redeem',
      {},
      expect.objectContaining({ Authorization: 'Bearer auth-token' }),
      60000,
    );
  });

  it('powinien obsłużyć format obiektu {token, validUntil} dla accessToken i refreshToken', async () => {
    mockFns.post.mockResolvedValue({
      ok: true,
      json: async () => ({
        accessToken: { token: 'acc-from-obj', validUntil: '2030' },
        refreshToken: { token: 'ref-from-obj', validUntil: '2030' },
      }),
    });

    const result = await redeemToken('auth-token', 'https://api-test.ksef.mf.gov.pl');

    expect(result).toEqual({ accessToken: 'acc-from-obj', refreshToken: 'ref-from-obj' });
  });

  it('powinien rzucić błąd gdy API zwraca HTTP błąd', async () => {
    mockFns.post.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    await expect(redeemToken('auth-token', 'https://api-test.ksef.mf.gov.pl')).rejects.toThrow(
      'Token redeem failed: HTTP 403 - Forbidden',
    );
  });
});

// --------------------------------------------------------------------------
// authenticate
// --------------------------------------------------------------------------

describe('authenticate', () => {
  function setupHappyPath(): void {
    const authToken = { token: 'auth-token-xyz', validUntil: '2030-01-01' };

    mockFns.readFile.mockResolvedValue('ksef-token\n');
    mockFns.getPublicKey.mockResolvedValue('MOCK-PEM');
    mockFns.getChallenge.mockResolvedValue({ challenge: 'chall-abc', timestampMs: 1700000000000 });
    mockFns.encryptKsefToken.mockReturnValue('encrypted-token');

    mockFns.post
      // krok 5: submitKsefTokenAuth
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authenticationToken: authToken, referenceNumber: 'REF-001' }),
      })
      // krok 7: redeemToken
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'final-access', refreshToken: 'final-refresh' }),
      });

    // krok 6: pollAuthStatus → checkAuthStatus → fetch
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: { code: 200 } }), { status: 200 }));
  }

  it('powinien wykonać pełny happy path w poprawnej kolejności kroków', async () => {
    setupHappyPath();

    const result = await authenticate(MOCK_CONFIG);

    expect(result).toEqual({ accessToken: 'final-access', refreshToken: 'final-refresh' });

    // Weryfikacja kolejności kroków
    expect(mockFns.readFile).toHaveBeenCalledWith(MOCK_CONFIG.tokenPath);
    expect(mockFns.getPublicKey).toHaveBeenCalledWith(MOCK_CONFIG);
    expect(mockFns.getChallenge).toHaveBeenCalledWith(MOCK_CONFIG.baseUrl);
    expect(mockFns.encryptKsefToken).toHaveBeenCalledWith('ksef-token', 1700000000000, 'MOCK-PEM');
    expect(mockFns.post).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledOnce(); // pollAuthStatus
  });

  it('powinien propagować błąd gdy getPublicKey rzuca wyjątek', async () => {
    mockFns.readFile.mockResolvedValue('ksef-token');
    mockFns.getPublicKey.mockRejectedValue(new Error('Brak certyfikatu'));

    await expect(authenticate(MOCK_CONFIG)).rejects.toThrow('Brak certyfikatu');
    expect(mockFns.getChallenge).not.toHaveBeenCalled();
  });

  it('powinien propagować błąd gdy getChallenge rzuca wyjątek', async () => {
    mockFns.readFile.mockResolvedValue('ksef-token');
    mockFns.getPublicKey.mockResolvedValue('MOCK-PEM');
    mockFns.getChallenge.mockRejectedValue(new Error('Serwer niedostępny'));

    await expect(authenticate(MOCK_CONFIG)).rejects.toThrow('Serwer niedostępny');
    expect(mockFns.post).not.toHaveBeenCalled();
  });

  it('powinien propagować błąd gdy submitKsefTokenAuth rzuca wyjątek', async () => {
    mockFns.readFile.mockResolvedValue('ksef-token');
    mockFns.getPublicKey.mockResolvedValue('MOCK-PEM');
    mockFns.getChallenge.mockResolvedValue({ challenge: 'x', timestampMs: 0 });
    mockFns.encryptKsefToken.mockReturnValue('enc');
    mockFns.post.mockResolvedValue({ ok: false, status: 500, text: async () => 'Server Error' });

    await expect(authenticate(MOCK_CONFIG)).rejects.toThrow('KSeF token auth failed: HTTP 500');
    expect(fetch).not.toHaveBeenCalled();
  });
});
