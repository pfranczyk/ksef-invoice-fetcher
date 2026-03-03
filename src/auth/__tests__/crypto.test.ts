import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTokenPayload,
  decodeBase64,
  encodeBase64,
  encryptAesKey,
  encryptKsefToken,
  encryptRSA,
  generateAesKey,
  generateIV,
} from '../crypto.ts';

// ---------------------------------------------------------------------------
// Mocki node-forge
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const publicKey = { encrypt: vi.fn() };
  const forge = {
    util: {
      encode64: vi.fn(),
      decode64: vi.fn(),
    },
    pki: {
      certificateFromPem: vi.fn(),
      publicKeyFromPem: vi.fn(),
    },
    md: {
      sha256: {
        create: vi.fn(),
      },
    },
    random: {
      getBytesSync: vi.fn(),
    },
  };
  return { publicKey, forge };
});

vi.mock('node-forge', () => ({ default: mocks.forge }));

// Przykładowe PEM-y używane w testach
const SAMPLE_PEM_CERT = '-----BEGIN CERTIFICATE-----\nTESTCERT\n-----END CERTIFICATE-----';
const SAMPLE_PEM_KEY = '-----BEGIN PUBLIC KEY-----\nTESTKEY\n-----END PUBLIC KEY-----';

beforeEach(() => {
  vi.clearAllMocks();
  // Domyślne zachowania — nadpisywane w konkretnych testach gdy trzeba
  mocks.publicKey.encrypt.mockReturnValue('zaszyfrowane-bajty');
  mocks.forge.util.encode64.mockReturnValue('base64wynik');
  mocks.forge.util.decode64.mockReturnValue('odkodowane');
  mocks.forge.pki.certificateFromPem.mockReturnValue({ publicKey: mocks.publicKey });
  mocks.forge.pki.publicKeyFromPem.mockReturnValue(mocks.publicKey);
  mocks.forge.md.sha256.create.mockReturnValue({});
  mocks.forge.random.getBytesSync.mockReturnValue('losowe-bajty');
});

// ---------------------------------------------------------------------------
// encodeBase64
// ---------------------------------------------------------------------------

describe('encodeBase64', () => {
  it('powinien zakodować string do Base64 używając forge.util.encode64', () => {
    mocks.forge.util.encode64.mockReturnValue('aGVsbG8=');

    const result = encodeBase64('hello');

    expect(mocks.forge.util.encode64).toHaveBeenCalledWith('hello');
    expect(result).toBe('aGVsbG8=');
  });

  it('powinien zwrócić pusty string dla pustego wejścia', () => {
    mocks.forge.util.encode64.mockReturnValue('');

    const result = encodeBase64('');

    expect(mocks.forge.util.encode64).toHaveBeenCalledWith('');
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// decodeBase64
// ---------------------------------------------------------------------------

describe('decodeBase64', () => {
  it('powinien odkodować string z Base64 używając forge.util.decode64', () => {
    mocks.forge.util.decode64.mockReturnValue('hello');

    const result = decodeBase64('aGVsbG8=');

    expect(mocks.forge.util.decode64).toHaveBeenCalledWith('aGVsbG8=');
    expect(result).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// createTokenPayload
// ---------------------------------------------------------------------------

describe('createTokenPayload', () => {
  it('powinien złączyć token i timestamp znakiem "|"', () => {
    expect(createTokenPayload('TOKEN123', 1707388800000)).toBe('TOKEN123|1707388800000');
  });

  it('powinien obsłużyć pusty token', () => {
    expect(createTokenPayload('', 0)).toBe('|0');
  });
});

// ---------------------------------------------------------------------------
// encryptRSA
// ---------------------------------------------------------------------------

describe('encryptRSA', () => {
  it('powinien zaszyfrować dane używając certyfikatu PEM', () => {
    mocks.forge.util.encode64.mockReturnValue('dGVzdA==');

    const result = encryptRSA('dane-testowe', SAMPLE_PEM_CERT);

    expect(mocks.forge.pki.certificateFromPem).toHaveBeenCalledWith(SAMPLE_PEM_CERT);
    expect(mocks.publicKey.encrypt).toHaveBeenCalledWith('dane-testowe', 'RSA-OAEP', expect.any(Object));
    expect(mocks.forge.util.encode64).toHaveBeenCalled();
    expect(result).toBe('dGVzdA==');
  });

  it('powinien zaszyfrować dane używając klucza publicznego PEM', () => {
    mocks.forge.util.encode64.mockReturnValue('dGVzdA==');

    const result = encryptRSA('dane-testowe', SAMPLE_PEM_KEY);

    expect(mocks.forge.pki.publicKeyFromPem).toHaveBeenCalledWith(SAMPLE_PEM_KEY);
    expect(mocks.publicKey.encrypt).toHaveBeenCalled();
    expect(result).toBe('dGVzdA==');
  });

  it('powinien użyć algorytmu RSA-OAEP z SHA-256 (md i mgf1)', () => {
    encryptRSA('dane', SAMPLE_PEM_CERT);

    const callArgs = mocks.publicKey.encrypt.mock.calls[0];
    expect(callArgs[1]).toBe('RSA-OAEP');
    expect(callArgs[2]).toHaveProperty('md');
    expect(callArgs[2]).toHaveProperty('mgf1');
  });

  it('powinien rzucić błąd gdy certyfikat PEM jest nieprawidłowy', () => {
    mocks.forge.pki.certificateFromPem.mockImplementation(() => {
      throw new Error('invalid PEM certificate');
    });

    expect(() => encryptRSA('dane', SAMPLE_PEM_CERT)).toThrow('Błąd szyfrowania RSA');
  });

  it('powinien rzucić błąd gdy klucz publiczny PEM jest nieprawidłowy', () => {
    mocks.forge.pki.publicKeyFromPem.mockImplementation(() => {
      throw new Error('invalid public key');
    });

    expect(() => encryptRSA('dane', SAMPLE_PEM_KEY)).toThrow('Błąd szyfrowania RSA');
  });
});

// ---------------------------------------------------------------------------
// encryptKsefToken
// ---------------------------------------------------------------------------

describe('encryptKsefToken', () => {
  it('powinien zaszyfrować payload w formacie token|timestamp', () => {
    mocks.forge.util.encode64.mockReturnValue('encrypted-ksef-token');

    const result = encryptKsefToken('MOJ_TOKEN', 1707388800000, SAMPLE_PEM_CERT);

    expect(mocks.publicKey.encrypt).toHaveBeenCalledWith('MOJ_TOKEN|1707388800000', 'RSA-OAEP', expect.any(Object));
    expect(result).toBe('encrypted-ksef-token');
  });

  it('powinien rzucić błąd gdy szyfrowanie RSA się nie powiedzie', () => {
    mocks.forge.pki.certificateFromPem.mockImplementation(() => {
      throw new Error('cert error');
    });

    expect(() => encryptKsefToken('TOKEN', 0, SAMPLE_PEM_CERT)).toThrow('Błąd szyfrowania tokenu KSeF');
  });
});

// ---------------------------------------------------------------------------
// generateAesKey
// ---------------------------------------------------------------------------

describe('generateAesKey', () => {
  it('powinien wygenerować 32 losowe bajty klucza AES-256 przez forge', () => {
    const klucz32 = 'a'.repeat(32);
    mocks.forge.random.getBytesSync.mockReturnValue(klucz32);

    const result = generateAesKey();

    expect(mocks.forge.random.getBytesSync).toHaveBeenCalledWith(32);
    expect(result).toBe(klucz32);
  });
});

// ---------------------------------------------------------------------------
// generateIV
// ---------------------------------------------------------------------------

describe('generateIV', () => {
  it('powinien wygenerować 16 losowych bajtów IV przez forge', () => {
    const iv16 = 'b'.repeat(16);
    mocks.forge.random.getBytesSync.mockReturnValue(iv16);

    const result = generateIV();

    expect(mocks.forge.random.getBytesSync).toHaveBeenCalledWith(16);
    expect(result).toBe(iv16);
  });
});

// ---------------------------------------------------------------------------
// encryptAesKey
// ---------------------------------------------------------------------------

describe('encryptAesKey', () => {
  it('powinien zaszyfrować klucz AES metodą RSA-OAEP (deleguje do encryptRSA)', () => {
    mocks.forge.util.encode64.mockReturnValue('zaszyfrowany-klucz-aes');
    const aesKey = 'c'.repeat(32);

    const result = encryptAesKey(aesKey, SAMPLE_PEM_CERT);

    expect(mocks.publicKey.encrypt).toHaveBeenCalledWith(aesKey, 'RSA-OAEP', expect.any(Object));
    expect(result).toBe('zaszyfrowany-klucz-aes');
  });
});
