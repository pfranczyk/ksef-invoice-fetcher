import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfig, ILogger } from '../../types.ts';
import { initExport, waitForExportCompletion } from '../export-api.ts';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockFns = vi.hoisted(() => ({
  httpRequest: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock('../../utils/http-client.ts', () => ({
  httpRequest: mockFns.httpRequest,
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

const MOCK_LOGGER: ILogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const ACCESS_TOKEN = 'test-jwt-access-token';
const REFERENCE_NUMBER = 'REF-2026-001';

const ENCRYPTION = Object.freeze({
  encryptedSymmetricKey: 'encryptedKey-b64',
  initializationVector: 'iv-b64',
});

const FILTERS = Object.freeze({
  subjectType: 'subject1',
  dateRange: Object.freeze({
    dateType: 'InvoiceIssueDate',
    from: '2026-01-01',
    to: '2026-01-31',
  }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFns.sleep.mockResolvedValue(undefined);
});

// --------------------------------------------------------------------------
// initExport
// --------------------------------------------------------------------------

describe('initExport', () => {
  it('powinien zwrócić numer referencyjny z odpowiedzi API', async () => {
    mockFns.httpRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ referenceNumber: REFERENCE_NUMBER }),
    });

    const result = await initExport({
      config: MOCK_CONFIG,
      accessToken: ACCESS_TOKEN,
      encryption: ENCRYPTION,
      filters: FILTERS,
    });

    expect(result).toBe(REFERENCE_NUMBER);
  });

  it('powinien wysłać POST z poprawnym URL i body zawierającym encryption i filters', async () => {
    mockFns.httpRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ referenceNumber: REFERENCE_NUMBER }),
    });

    await initExport({
      config: MOCK_CONFIG,
      accessToken: ACCESS_TOKEN,
      encryption: ENCRYPTION,
      filters: FILTERS,
    });

    const [url, init] = mockFns.httpRequest.mock.calls[0] as [string, RequestInit, unknown];
    expect(url).toBe('https://api-test.ksef.mf.gov.pl/v2/invoices/exports');
    expect(init.method).toBe('POST');
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody.encryption.encryptedSymmetricKey).toBe('encryptedKey-b64');
    expect(parsedBody.encryption.initializationVector).toBe('iv-b64');
    expect(parsedBody.filters.subjectType).toBe('subject1');
  });

  it('powinien rzucić błąd gdy HTTP odpowiedź nie jest OK', async () => {
    mockFns.httpRequest.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(
      initExport({ config: MOCK_CONFIG, accessToken: ACCESS_TOKEN, encryption: ENCRYPTION, filters: FILTERS }),
    ).rejects.toThrow('Nie udało się zainicjalizować eksportu: HTTP 401 - Unauthorized');
  });
});

// --------------------------------------------------------------------------
// waitForExportCompletion
// --------------------------------------------------------------------------

describe('waitForExportCompletion', () => {
  it('powinien zwrócić status gdy API zwróci kod 200 (sukces) od razu', async () => {
    const packageInfo = { invoiceCount: 5, size: 1024, parts: [] };
    mockFns.httpRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ status: { code: 200, description: 'OK' }, package: packageInfo }),
    });

    const result = await waitForExportCompletion({
      config: MOCK_CONFIG,
      accessToken: ACCESS_TOKEN,
      referenceNumber: REFERENCE_NUMBER,
      logger: MOCK_LOGGER,
    });

    expect(result.status?.code).toBe(200);
    expect(result.package).toEqual(packageInfo);
    expect(mockFns.httpRequest).toHaveBeenCalledOnce();
    expect(mockFns.sleep).not.toHaveBeenCalled();
  });

  it('powinien ponowić polling gdy kod 100, a następnie zwrócić 200', async () => {
    mockFns.httpRequest
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: { code: 100, description: 'Processing' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: { code: 200, description: 'OK' },
          package: { invoiceCount: 2, size: 512, parts: [] },
        }),
      });

    const result = await waitForExportCompletion({
      config: MOCK_CONFIG,
      accessToken: ACCESS_TOKEN,
      referenceNumber: REFERENCE_NUMBER,
      logger: MOCK_LOGGER,
    });

    expect(result.status?.code).toBe(200);
    expect(mockFns.httpRequest).toHaveBeenCalledTimes(2);
    expect(mockFns.sleep).toHaveBeenCalledWith(5000); // exportPollIntervalSeconds * 1000
  });

  it('powinien rzucić błąd gdy eksport wygasł (kod 210)', async () => {
    mockFns.httpRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ status: { code: 210 } }),
    });

    await expect(
      waitForExportCompletion({
        config: MOCK_CONFIG,
        accessToken: ACCESS_TOKEN,
        referenceNumber: REFERENCE_NUMBER,
        logger: MOCK_LOGGER,
      }),
    ).rejects.toThrow('Eksport faktur wygasł (status 210). Uruchom eksport ponownie.');
  });

  it('powinien rzucić błąd przy kodzie 415 (błąd odszyfrowania klucza)', async () => {
    mockFns.httpRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ status: { code: 415 } }),
    });

    await expect(
      waitForExportCompletion({
        config: MOCK_CONFIG,
        accessToken: ACCESS_TOKEN,
        referenceNumber: REFERENCE_NUMBER,
        logger: MOCK_LOGGER,
      }),
    ).rejects.toThrow('Błąd odszyfrowania dostarczonego klucza (status 415). Sprawdź implementację szyfrowania.');
  });

  it('powinien rzucić błąd przy kodzie 420 (zakres dat poza zakresem)', async () => {
    mockFns.httpRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ status: { code: 420 } }),
    });

    await expect(
      waitForExportCompletion({
        config: MOCK_CONFIG,
        accessToken: ACCESS_TOKEN,
        referenceNumber: REFERENCE_NUMBER,
        logger: MOCK_LOGGER,
      }),
    ).rejects.toThrow('Zakres dat jest poza dostępnym zakresem danych w KSeF (status 420).');
  });

  it('powinien rzucić błąd przy kodzie 500 (błąd wewnętrzny KSeF)', async () => {
    mockFns.httpRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ status: { code: 500 } }),
    });

    await expect(
      waitForExportCompletion({
        config: MOCK_CONFIG,
        accessToken: ACCESS_TOKEN,
        referenceNumber: REFERENCE_NUMBER,
        logger: MOCK_LOGGER,
      }),
    ).rejects.toThrow('Błąd wewnętrzny KSeF (status 500) podczas eksportu faktur.');
  });

  it('powinien rzucić błąd przy kodzie 550 (eksport anulowany)', async () => {
    mockFns.httpRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ status: { code: 550 } }),
    });

    await expect(
      waitForExportCompletion({
        config: MOCK_CONFIG,
        accessToken: ACCESS_TOKEN,
        referenceNumber: REFERENCE_NUMBER,
        logger: MOCK_LOGGER,
      }),
    ).rejects.toThrow('Operacja eksportu została anulowana przez KSeF (status 550).');
  });

  it('powinien rzucić błąd przy nieznanym kodzie statusu', async () => {
    mockFns.httpRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ status: { code: 999, description: 'Nieznany' } }),
    });

    await expect(
      waitForExportCompletion({
        config: MOCK_CONFIG,
        accessToken: ACCESS_TOKEN,
        referenceNumber: REFERENCE_NUMBER,
        logger: MOCK_LOGGER,
      }),
    ).rejects.toThrow('Nieoczekiwany status eksportu: 999 - Nieznany');
  });

  it('powinien rzucić błąd po przekroczeniu limitu czasu oczekiwania', async () => {
    // Date.now(): pierwsze wywołanie = startTime, drugie = sprawdzenie timeoutu w pętli
    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0) // startTime
      .mockReturnValueOnce(700_000); // pierwsza iteracja: 700s > 600s (10 min) → timeout

    await expect(
      waitForExportCompletion({
        config: MOCK_CONFIG,
        accessToken: ACCESS_TOKEN,
        referenceNumber: REFERENCE_NUMBER,
        logger: MOCK_LOGGER,
      }),
    ).rejects.toThrow('Przekroczono limit oczekiwania na status eksportu po 10 min');

    dateNowSpy.mockRestore();
    expect(mockFns.httpRequest).not.toHaveBeenCalled();
  });
});
