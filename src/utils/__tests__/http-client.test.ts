import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, httpRequest, post, TIMEOUTS } from '../http-client.ts';
import { sleep } from '../sleep.ts';

// sleep mockujemy żeby testy z 429 nie czekały rzeczywiście N sekund
vi.mock('../sleep.ts', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// logger mockujemy żeby nie zaśmiecać outputu testów
vi.mock('../logger.ts', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Tworzy mock Response z podanym statusem i opcjonalnymi nagłówkami
 */
function makeMockResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// TIMEOUTS
// ---------------------------------------------------------------------------

describe('TIMEOUTS', () => {
  it('powinien zawierać poprawne wartości timeoutów w milisekundach', () => {
    expect(TIMEOUTS.DEFAULT).toBe(30000);
    expect(TIMEOUTS.AUTH).toBe(60000);
    expect(TIMEOUTS.EXPORT_INIT).toBe(45000);
    expect(TIMEOUTS.EXPORT_STATUS).toBe(30000);
    expect(TIMEOUTS.DOWNLOAD).toBe(120000);
    expect(TIMEOUTS.PUBLIC_KEY).toBe(20000);
  });
});

// ---------------------------------------------------------------------------
// httpRequest
// ---------------------------------------------------------------------------

describe('httpRequest', () => {
  it('powinien zwrócić odpowiedź gdy fetch zakończy się sukcesem', async () => {
    const mockResponse = makeMockResponse(200);
    vi.mocked(fetch).mockResolvedValue(mockResponse);

    const result = await httpRequest('https://api.example.com/test');

    expect(result).toBe(mockResponse);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('powinien wysłać domyślne nagłówki Content-Type i Accept', async () => {
    vi.mocked(fetch).mockResolvedValue(makeMockResponse(200));

    await httpRequest('https://api.example.com/test');

    const calledOptions = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = calledOptions.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Accept).toBe('application/json');
  });

  it('powinien nadpisać domyślne nagłówki gdy podano własne', async () => {
    vi.mocked(fetch).mockResolvedValue(makeMockResponse(200));

    await httpRequest('https://api.example.com/test', {
      headers: { Authorization: 'Bearer token123', Accept: 'application/xml' },
    });

    const calledOptions = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = calledOptions.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token123');
    expect(headers.Accept).toBe('application/xml');
    expect(headers['Content-Type']).toBe('application/json'); // domyślny zachowany
  });

  it('powinien poczekać Retry-After sekund i ponowić żądanie po HTTP 429', async () => {
    const response429 = makeMockResponse(429, { 'Retry-After': '2' });
    const response200 = makeMockResponse(200);
    vi.mocked(fetch).mockResolvedValueOnce(response429).mockResolvedValueOnce(response200);

    const result = await httpRequest('https://api.example.com/test', {}, { maxRetries: 3 });

    expect(result).toBe(response200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sleep)).toHaveBeenCalledWith(2000); // 2s z nagłówka
  });

  it('powinien użyć domyślnych 60 sekund gdy brak nagłówka Retry-After', async () => {
    const response429 = makeMockResponse(429); // brak Retry-After
    const response200 = makeMockResponse(200);
    vi.mocked(fetch).mockResolvedValueOnce(response429).mockResolvedValueOnce(response200);

    await httpRequest('https://api.example.com/test', {}, { maxRetries: 3 });

    expect(vi.mocked(sleep)).toHaveBeenCalledWith(60000); // 60s domyślnie
  });

  it('powinien rzucić błąd po wyczerpaniu wszystkich prób przy HTTP 429', async () => {
    vi.mocked(fetch).mockResolvedValue(makeMockResponse(429, { 'Retry-After': '1' }));

    await expect(httpRequest('https://api.example.com/test', {}, { maxRetries: 2 })).rejects.toThrow(
      'Przekroczono limit zapytań po 2 próbach',
    );
  });

  it('powinien rzucić błąd z komunikatem o timeout gdy fetch zwróci AbortError', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.mocked(fetch).mockRejectedValue(abortError);

    await expect(httpRequest('https://api.example.com/test', {}, { timeout: 5000 })).rejects.toThrow(
      'Request timeout po 5000ms: https://api.example.com/test',
    );
  });

  it('powinien ponownie rzucić błąd sieciowy bez modyfikacji', async () => {
    const networkError = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    vi.mocked(fetch).mockRejectedValue(networkError);

    await expect(httpRequest('https://api.example.com/test')).rejects.toThrow('connection reset');
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe('get', () => {
  it('powinien wywołać fetch z metodą GET', async () => {
    vi.mocked(fetch).mockResolvedValue(makeMockResponse(200));

    await get('https://api.example.com/resource');

    const calledOptions = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(calledOptions.method).toBe('GET');
  });

  it('powinien przekazać nagłówki do żądania', async () => {
    vi.mocked(fetch).mockResolvedValue(makeMockResponse(200));

    await get('https://api.example.com/resource', { Authorization: 'Bearer tok' });

    const calledOptions = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = calledOptions.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });
});

// ---------------------------------------------------------------------------
// post
// ---------------------------------------------------------------------------

describe('post', () => {
  it('powinien wywołać fetch z metodą POST', async () => {
    vi.mocked(fetch).mockResolvedValue(makeMockResponse(200));

    await post('https://api.example.com/resource', { key: 'value' });

    const calledOptions = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(calledOptions.method).toBe('POST');
  });

  it('powinien serializować body do JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(makeMockResponse(200));

    await post('https://api.example.com/resource', { numerFaktury: 'FV/2026/001' });

    const calledOptions = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(calledOptions.body).toBe(JSON.stringify({ numerFaktury: 'FV/2026/001' }));
  });

  it('powinien przekazać nagłówki do żądania', async () => {
    vi.mocked(fetch).mockResolvedValue(makeMockResponse(200));

    await post('https://api.example.com/resource', {}, { Authorization: 'Bearer tok' });

    const calledOptions = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = calledOptions.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });
});
