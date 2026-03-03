import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types.ts';
import { computeSha256Base64, decryptAes256Cbc, generateEncryptionParams, isZipMagicBytes } from '../export-crypto.ts';

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

const NOW_MS = 1767268800000; // 2026-01-01T12:00:00.000Z — certyfikaty są w zakresie 2020–2030

// --------------------------------------------------------------------------
// Mocki forge (używane tylko przez generateEncryptionParams)
// --------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  randomGetBytesSync: vi.fn(),
  pkiCertificateFromAsn1: vi.fn(),
  pkiCertificateToPem: vi.fn(),
  pkiCertificateFromPem: vi.fn(),
  utilDecode64: vi.fn(),
  asn1FromDer: vi.fn(),
  mdSha256Create: vi.fn(),
  publicKeyEncrypt: vi.fn(),
  utilEncode64: vi.fn(),
}));

vi.mock('node-forge', () => ({
  default: {
    random: { getBytesSync: mocks.randomGetBytesSync },
    pki: {
      certificateFromAsn1: mocks.pkiCertificateFromAsn1,
      certificateToPem: mocks.pkiCertificateToPem,
      certificateFromPem: mocks.pkiCertificateFromPem,
    },
    util: {
      decode64: mocks.utilDecode64,
      encode64: mocks.utilEncode64,
    },
    asn1: { fromDer: mocks.asn1FromDer },
    md: { sha256: { create: mocks.mdSha256Create } },
  },
}));

const MOCK_ASN1 = {};
const MOCK_CERT_FROM_ASN1 = {};
const MOCK_PUBLIC_KEY = { encrypt: mocks.publicKeyEncrypt };
const MOCK_CERT_FROM_PEM = { publicKey: MOCK_PUBLIC_KEY };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  vi.stubGlobal('fetch', vi.fn());

  // Domyślne implementacje forge (dla generateEncryptionParams)
  mocks.randomGetBytesSync
    .mockReturnValueOnce('a'.repeat(32)) // AES key bytes
    .mockReturnValueOnce('b'.repeat(16)); // IV bytes

  mocks.utilDecode64.mockReturnValue('der-bytes');
  mocks.asn1FromDer.mockReturnValue(MOCK_ASN1);
  mocks.pkiCertificateFromAsn1.mockReturnValue(MOCK_CERT_FROM_ASN1);
  mocks.pkiCertificateToPem.mockReturnValue('MOCK-PEM');
  mocks.pkiCertificateFromPem.mockReturnValue(MOCK_CERT_FROM_PEM);
  mocks.mdSha256Create.mockReturnValue({});
  mocks.publicKeyEncrypt.mockReturnValue('encrypted-key-bytes');
  mocks.utilEncode64
    .mockReturnValueOnce('encryptedSymmetricKey-b64') // encryptedKey
    .mockReturnValueOnce('initializationVector-b64'); // ivBytes
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// --------------------------------------------------------------------------
// isZipMagicBytes
// --------------------------------------------------------------------------

describe('isZipMagicBytes', () => {
  it('powinien zwrócić true dla bufora z sygnaturą ZIP (0x50 0x4B 0x03 0x04)', () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);

    expect(isZipMagicBytes(buf)).toBe(true);
  });

  it('powinien zwrócić false gdy bufor nie zaczyna się od sygnatury ZIP', () => {
    const buf = Buffer.from([0x00, 0x4b, 0x03, 0x04, 0x00]);

    expect(isZipMagicBytes(buf)).toBe(false);
  });

  it('powinien zwrócić false gdy bufor jest krótszy niż 4 bajty', () => {
    expect(isZipMagicBytes(Buffer.from([0x50, 0x4b]))).toBe(false);
  });

  it('powinien zwrócić false dla pustego bufora', () => {
    expect(isZipMagicBytes(Buffer.alloc(0))).toBe(false);
  });
});

// --------------------------------------------------------------------------
// computeSha256Base64
// --------------------------------------------------------------------------

describe('computeSha256Base64', () => {
  it('powinien obliczyć SHA-256 pustego bufora i zakodować w Base64', () => {
    // SHA-256('') = e3b0c44298fc1c149afbf4c8996fb924... → Base64: 47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=
    const result = computeSha256Base64(Buffer.alloc(0));

    expect(result).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });

  it('powinien obliczyć SHA-256 bufora z danymi i zakodować w Base64', () => {
    // SHA-256('hello') = 2cf24dba... → Base64: LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=
    const result = computeSha256Base64(Buffer.from('hello'));

    expect(result).toBe('LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=');
  });
});

// --------------------------------------------------------------------------
// decryptAes256Cbc
// --------------------------------------------------------------------------

describe('decryptAes256Cbc', () => {
  it('powinien odszyfrować dane zaszyfrowane AES-256-CBC (round-trip)', () => {
    const aesKey = Buffer.alloc(32, 0x61); // 32 × 'a'
    const iv = Buffer.alloc(16, 0x62); // 16 × 'b'
    const plaintext = Buffer.from('dane do testów szyfrowania');

    // Szyfruj przy użyciu realnego Node.js crypto
    const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
    const encryptedData = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    const decrypted = decryptAes256Cbc({ encryptedData, aesKey, iv });

    expect(decrypted.toString('utf-8')).toBe('dane do testów szyfrowania');
  });
});

// --------------------------------------------------------------------------
// generateEncryptionParams
// --------------------------------------------------------------------------

describe('generateEncryptionParams', () => {
  it('powinien zwrócić parametry szyfrowania z wynikiem forge (AES key, IV, zaszyfrowany klucz)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            certificate: 'base64-der',
            usage: ['SymmetricKeyEncryption'],
            validFrom: '2020-01-01T00:00:00Z',
            validTo: '2030-01-01T00:00:00Z',
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await generateEncryptionParams(MOCK_CONFIG);

    // aesKey i iv powinny być Bufferami
    expect(Buffer.isBuffer(result.aesKey)).toBe(true);
    expect(result.aesKey.length).toBe(32);
    expect(Buffer.isBuffer(result.iv)).toBe(true);
    expect(result.iv.length).toBe(16);

    // Klucz symetryczny i IV zakodowane w Base64
    expect(result.encryptedSymmetricKey).toBe('encryptedSymmetricKey-b64');
    expect(result.initializationVector).toBe('initializationVector-b64');

    // Weryfikacja wywołań forge
    expect(mocks.randomGetBytesSync).toHaveBeenCalledWith(32);
    expect(mocks.randomGetBytesSync).toHaveBeenCalledWith(16);
    expect(mocks.publicKeyEncrypt).toHaveBeenCalledWith('a'.repeat(32), 'RSA-OAEP', expect.any(Object));
  });

  it('powinien odrzucić certyfikat bez usage=SymmetricKeyEncryption i rzucić błąd', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            certificate: 'base64-der',
            usage: ['KsefTokenEncryption'], // inny usage
            validFrom: '2020-01-01T00:00:00Z',
            validTo: '2030-01-01T00:00:00Z',
          },
        ]),
        { status: 200 },
      ),
    );

    await expect(generateEncryptionParams(MOCK_CONFIG)).rejects.toThrow(
      'Nie znaleziono ważnego certyfikatu z usage: SymmetricKeyEncryption',
    );
  });
});
