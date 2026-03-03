import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types.ts';
import { downloadPublicKeyFromAPI, getPublicKey } from '../public-key.ts';

// --------------------------------------------------------------------------
// Stałe testowe
// --------------------------------------------------------------------------

// NOW = 2026-01-01, żeby daty ważności certyfikatów miały sens
const NOW_MS = 1767268800000; // new Date('2026-01-01T12:00:00.000Z').getTime()

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

const MOCK_PEM = '-----BEGIN CERTIFICATE-----\nMOCKCERT\n-----END CERTIFICATE-----\n';

// Obiekty certyfikatów zwracane przez forge.pki.certificateFromPem
const VALID_CERT_VALIDITY = {
  validity: { notBefore: new Date('2020-01-01'), notAfter: new Date('2030-01-01') },
};
const EXPIRED_CERT_VALIDITY = {
  validity: { notBefore: new Date('2020-01-01'), notAfter: new Date('2025-01-01') },
};

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  fileExists: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  get: vi.fn(),
  getApiUrl: vi.fn(),
  pkiCertificateFromPem: vi.fn(),
  pkiCertificateFromAsn1: vi.fn(),
  pkiCertificateToPem: vi.fn(),
  utilDecode64: vi.fn(),
  asn1FromDer: vi.fn(),
}));

vi.mock('../../utils/file-system.ts', () => ({
  fileExists: mocks.fileExists,
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}));

vi.mock('../../utils/http-client.ts', () => ({
  get: mocks.get,
  TIMEOUTS: Object.freeze({ PUBLIC_KEY: 20000 }),
}));

vi.mock('../../config/env.ts', () => ({
  getApiUrl: mocks.getApiUrl,
}));

vi.mock('node-forge', () => ({
  default: {
    pki: {
      certificateFromPem: mocks.pkiCertificateFromPem,
      certificateFromAsn1: mocks.pkiCertificateFromAsn1,
      certificateToPem: mocks.pkiCertificateToPem,
    },
    util: {
      decode64: mocks.utilDecode64,
    },
    asn1: {
      fromDer: mocks.asn1FromDer,
    },
  },
}));

vi.mock('../../utils/logger.ts', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  maskSensitiveData: vi.fn((s: string) => s),
}));

const MOCK_ASN1 = {};
const MOCK_CERT_OBJ = {};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);

  // Domyślne implementacje forge
  mocks.pkiCertificateFromPem.mockReturnValue(VALID_CERT_VALIDITY);
  mocks.utilDecode64.mockReturnValue('der-bytes');
  mocks.asn1FromDer.mockReturnValue(MOCK_ASN1);
  mocks.pkiCertificateFromAsn1.mockReturnValue(MOCK_CERT_OBJ);
  mocks.pkiCertificateToPem.mockReturnValue(MOCK_PEM);
  mocks.getApiUrl.mockReturnValue('https://api-test.ksef.mf.gov.pl');
  mocks.writeFile.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeApiResponse(certs: unknown[]) {
  return { ok: true, json: async () => certs, text: async () => '' };
}

const SINGLE_VALID_CERT = [
  {
    certificate: 'base64-der',
    usage: ['KsefTokenEncryption'],
    validFrom: '2020-01-01T00:00:00Z',
    validTo: '2030-01-01T00:00:00Z',
  },
];

// --------------------------------------------------------------------------
// getPublicKey
// --------------------------------------------------------------------------

describe('getPublicKey', () => {
  it('powinien zwrócić certyfikat z cache gdy plik istnieje i cert jest ważny', async () => {
    mocks.fileExists.mockResolvedValue(true);
    mocks.readFile.mockResolvedValue(MOCK_PEM);
    // mocks.pkiCertificateFromPem domyślnie zwraca VALID_CERT_VALIDITY (do 2030)

    const result = await getPublicKey(MOCK_CONFIG);

    expect(result).toBe(MOCK_PEM);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('powinien pobrać certyfikat z API i zapisać do cache gdy plik nie istnieje', async () => {
    mocks.fileExists.mockResolvedValue(false);
    mocks.get.mockResolvedValue(makeApiResponse(SINGLE_VALID_CERT));

    const result = await getPublicKey(MOCK_CONFIG);

    expect(result).toBe(MOCK_PEM);
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.writeFile).toHaveBeenCalledWith(MOCK_CONFIG.publicKeyPath, MOCK_PEM);
  });

  it('powinien pobrać nowy certyfikat gdy cached cert wygasł', async () => {
    mocks.fileExists.mockResolvedValue(true);
    mocks.readFile.mockResolvedValue(MOCK_PEM);
    // Wygasły certyfikat w cache (notAfter = 2025 < NOW 2026)
    mocks.pkiCertificateFromPem.mockReturnValue(EXPIRED_CERT_VALIDITY);

    mocks.get.mockResolvedValue(makeApiResponse(SINGLE_VALID_CERT));

    const result = await getPublicKey(MOCK_CONFIG);

    expect(result).toBe(MOCK_PEM);
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.writeFile).toHaveBeenCalledWith(MOCK_CONFIG.publicKeyPath, MOCK_PEM);
  });
});

// --------------------------------------------------------------------------
// downloadPublicKeyFromAPI
// --------------------------------------------------------------------------

describe('downloadPublicKeyFromAPI', () => {
  it('powinien wybrać certyfikat z usage=KsefTokenEncryption spośród wielu', async () => {
    const certs = [
      {
        certificate: 'cert-other',
        usage: ['SomeOtherUsage'],
        validFrom: '2020-01-01T00:00:00Z',
        validTo: '2030-01-01T00:00:00Z',
      },
      {
        certificate: 'cert-ksef',
        usage: ['KsefTokenEncryption'],
        validFrom: '2020-01-01T00:00:00Z',
        validTo: '2030-01-01T00:00:00Z',
      },
    ];
    mocks.get.mockResolvedValue(makeApiResponse(certs));
    mocks.pkiCertificateToPem.mockReturnValue('PEM-KSEF-CERT');

    const result = await downloadPublicKeyFromAPI('TEST');

    // Wywołano decode64 tylko dla 'cert-ksef' — tego z KsefTokenEncryption
    expect(mocks.utilDecode64).toHaveBeenCalledWith('cert-ksef');
    expect(result).toBe('PEM-KSEF-CERT');
  });

  it('powinien odrzucić wygasłe certyfikaty i wybrać aktualnie ważny', async () => {
    const certs = [
      {
        certificate: 'cert-expired',
        usage: ['KsefTokenEncryption'],
        validFrom: '2020-01-01T00:00:00Z',
        validTo: '2025-01-01T00:00:00Z', // wygasły przed NOW (2026-01-01)
      },
      {
        certificate: 'cert-valid',
        usage: ['KsefTokenEncryption'],
        validFrom: '2020-01-01T00:00:00Z',
        validTo: '2030-01-01T00:00:00Z',
      },
    ];
    mocks.get.mockResolvedValue(makeApiResponse(certs));

    await downloadPublicKeyFromAPI('TEST');

    expect(mocks.utilDecode64).toHaveBeenCalledWith('cert-valid');
    expect(mocks.utilDecode64).not.toHaveBeenCalledWith('cert-expired');
  });

  it('powinien rzucić błąd gdy API zwraca błąd HTTP', async () => {
    mocks.get.mockResolvedValue({ ok: false, status: 502, text: async () => 'Bad Gateway' });

    await expect(downloadPublicKeyFromAPI('TEST')).rejects.toThrow(
      'Failed to download public key certificates: HTTP 502 - Bad Gateway',
    );
  });

  it('powinien rzucić błąd gdy żaden certyfikat nie ma usage=KsefTokenEncryption', async () => {
    mocks.get.mockResolvedValue(
      makeApiResponse([
        {
          certificate: 'x',
          usage: ['OtherUsage'],
          validFrom: '2020-01-01T00:00:00Z',
          validTo: '2030-01-01T00:00:00Z',
        },
      ]),
    );

    await expect(downloadPublicKeyFromAPI('TEST')).rejects.toThrow('No currently valid certificate found');
  });
});
