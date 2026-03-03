import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger, IPackagePart } from '../../types.ts';
import { downloadAndDecryptParts } from '../export-download.ts';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockFns = vi.hoisted(() => ({
  decryptAes256Cbc: vi.fn(),
  computeSha256Base64: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock('../export-crypto.ts', () => ({
  decryptAes256Cbc: mockFns.decryptAes256Cbc,
  computeSha256Base64: mockFns.computeSha256Base64,
}));

vi.mock('../../utils/http-client.ts', () => ({
  TIMEOUTS: Object.freeze({
    DEFAULT: 30000,
    AUTH: 60000,
    EXPORT_INIT: 45000,
    EXPORT_STATUS: 30000,
    DOWNLOAD: 120000,
    PUBLIC_KEY: 20000,
  }),
}));

vi.mock('../../utils/sleep.ts', () => ({
  sleep: mockFns.sleep,
}));

vi.mock('../../utils/logger.ts', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  maskSensitiveData: vi.fn((s: string) => s),
}));

// --------------------------------------------------------------------------
// Stałe testowe
// --------------------------------------------------------------------------

const AES_KEY = Buffer.alloc(32, 0xab);
const IV = Buffer.alloc(16, 0xcd);
const FUTURE_DATE = '2099-12-31T23:59:59Z';
const PAST_DATE = '2020-01-01T00:00:00Z';

const MOCK_LOGGER: ILogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/**
 * Tworzy zamockowaną odpowiedź fetch zwracającą podany bufor
 */
function makeFetchResponse(data: Buffer): Response {
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => ab,
  } as unknown as Response;
}

function makePart(overrides: Partial<IPackagePart> = {}): IPackagePart {
  return {
    ordinalNumber: 1,
    url: 'https://cdn.example.com/part1',
    method: 'GET',
    partSize: 512,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  mockFns.sleep.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --------------------------------------------------------------------------
// downloadAndDecryptParts
// --------------------------------------------------------------------------

describe('downloadAndDecryptParts', () => {
  it('powinien pobrać i odszyfrować jedną część i zwrócić wynik', async () => {
    const encryptedData = Buffer.from('zaszyfrowane-dane');
    const decryptedData = Buffer.from('odszyfrowane-dane');

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(makeFetchResponse(encryptedData));
    mockFns.computeSha256Base64.mockReturnValue('hash-bez-weryfikacji');
    mockFns.decryptAes256Cbc.mockReturnValue(decryptedData);

    const result = await downloadAndDecryptParts({
      parts: [makePart()],
      aesKey: AES_KEY,
      iv: IV,
      packageExpirationDate: FUTURE_DATE,
      logger: MOCK_LOGGER,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(decryptedData);
    expect(mockFns.decryptAes256Cbc).toHaveBeenCalledWith({
      encryptedData,
      aesKey: AES_KEY,
      iv: IV,
    });
  });

  it('powinien sortować części rosnąco po ordinalNumber przed pobraniem', async () => {
    const enc1 = Buffer.from('enc-1');
    const enc2 = Buffer.from('enc-2');
    const dec1 = Buffer.from('dec-1');
    const dec2 = Buffer.from('dec-2');

    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeFetchResponse(enc1))
      .mockResolvedValueOnce(makeFetchResponse(enc2));

    mockFns.computeSha256Base64.mockReturnValue('any-hash');
    mockFns.decryptAes256Cbc.mockReturnValueOnce(dec1).mockReturnValueOnce(dec2);

    const partA = makePart({ ordinalNumber: 2, url: 'https://cdn.example.com/part2' });
    const partB = makePart({ ordinalNumber: 1, url: 'https://cdn.example.com/part1' });

    const result = await downloadAndDecryptParts({
      parts: [partA, partB], // podane w odwrotnej kolejności
      aesKey: AES_KEY,
      iv: IV,
      packageExpirationDate: FUTURE_DATE,
      logger: MOCK_LOGGER,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(dec1);
    expect(result[1]).toEqual(dec2);

    // Weryfikuj kolejność URL – najpierw part1 (ordinalNumber=1), potem part2
    const fetchCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(fetchCalls[0][0]).toBe('https://cdn.example.com/part1');
    expect(fetchCalls[1][0]).toBe('https://cdn.example.com/part2');
  });

  it('powinien rzucić błąd gdy paczka wygasła przed rozpoczęciem pobierania', async () => {
    await expect(
      downloadAndDecryptParts({
        parts: [makePart()],
        aesKey: AES_KEY,
        iv: IV,
        packageExpirationDate: PAST_DATE,
        logger: MOCK_LOGGER,
      }),
    ).rejects.toThrow('Paczka wygasła przed rozpoczęciem pobierania');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('powinien rzucić błąd gdy link do części wygasł', async () => {
    const part = makePart({ expirationDate: PAST_DATE });

    await expect(
      downloadAndDecryptParts({
        parts: [part],
        aesKey: AES_KEY,
        iv: IV,
        packageExpirationDate: FUTURE_DATE,
        logger: MOCK_LOGGER,
      }),
    ).rejects.toThrow('Link do części 1 wygasł – uruchom eksport ponownie');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('powinien ponowić próbę po błędzie sieciowym 503, a następnie zwrócić wynik', async () => {
    const decryptedData = Buffer.from('odszyfrowane');

    (fetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('HTTP 503 Service Unavailable'))
      .mockResolvedValueOnce(makeFetchResponse(Buffer.from('enc')));

    mockFns.computeSha256Base64.mockReturnValue('hash');
    mockFns.decryptAes256Cbc.mockReturnValue(decryptedData);

    const result = await downloadAndDecryptParts({
      parts: [makePart()],
      aesKey: AES_KEY,
      iv: IV,
      packageExpirationDate: FUTURE_DATE,
      logger: MOCK_LOGGER,
    });

    expect(result[0]).toEqual(decryptedData);
    expect(mockFns.sleep).toHaveBeenCalledWith(20000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('powinien rzucić błąd natychmiast gdy encryptedPartHash nie zgadza się (bez retry)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(makeFetchResponse(Buffer.from('enc')));
    mockFns.computeSha256Base64.mockReturnValue('faktyczny-hash');

    const part = makePart({ encryptedPartHash: 'oczekiwany-hash' });

    await expect(
      downloadAndDecryptParts({
        parts: [part],
        aesKey: AES_KEY,
        iv: IV,
        packageExpirationDate: FUTURE_DATE,
        logger: MOCK_LOGGER,
      }),
    ).rejects.toThrow('Część 1: niezgodność encryptedPartHash. Oczekiwano: oczekiwany-hash, otrzymano: faktyczny-hash');

    expect(mockFns.sleep).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
