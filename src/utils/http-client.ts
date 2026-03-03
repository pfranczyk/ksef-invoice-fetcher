/**
 * Klient HTTP (fetch) z obsługą błędów i retry
 */
import logger from './logger.ts';
import { sleep } from './sleep.ts';

/**
 * Typ dla timeoutów różnych typów operacji
 */
type TTimeouts = {
  // 30s - domyślny timeout
  readonly DEFAULT: number;
  // 60s - uwierzytelnianie może trwać dłużej
  readonly AUTH: number;
  // 45s - inicjalizacja eksportu
  readonly EXPORT_INIT: number;
  // 30s - sprawdzenie statusu
  readonly EXPORT_STATUS: number;
  // 120s - pobieranie plików może trwać dłużej
  readonly DOWNLOAD: number;
  // 20s - pobieranie klucza publicznego
  readonly PUBLIC_KEY: number;
};

/**
 * Timeouty dla różnych typów operacji (w milisekundach)
 */
export const TIMEOUTS = Object.freeze<TTimeouts>({
  DEFAULT: 30000,
  AUTH: 60000,
  EXPORT_INIT: 45000,
  EXPORT_STATUS: 30000,
  DOWNLOAD: 120000,
  PUBLIC_KEY: 20000,
});

/**
 * Tworzy kontroler AbortController z timeoutem
 * @param {number} timeoutMs - Timeout w milisekundach
 * @returns {AbortController} Kontroler abort
 */
function createAbortController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Cleanup timeout po zakończeniu requestu
  controller.signal.addEventListener('abort', () => clearTimeout(timeoutId));

  return controller;
}

/**
 * Opcje retry dla HTTP requestów
 */
export type TRetryOptions = {
  readonly maxRetries?: number;
  readonly currentAttempt?: number;
  readonly timeout?: number;
  readonly context?: string;
};

/**
 * Wykonuje żądanie HTTP z obsługą błędów i retry dla HTTP 429
 * @param {string} url - URL żądania
 * @param {RequestInit} options - Opcje fetch
 * @param {TRetryOptions} retryOptions - Opcje retry
 * @returns {Promise<Response>} Odpowiedź HTTP
 * @throws {Error} Gdy przekroczono limit zapytań lub wystąpił błąd sieci
 */
export async function httpRequest(
  url: string,
  options: RequestInit = {},
  retryOptions: TRetryOptions = {},
): Promise<Response> {
  const { maxRetries = 3, currentAttempt = 1, timeout = TIMEOUTS.DEFAULT, context } = retryOptions;

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // Utwórz AbortController z timeoutem
  const controller = createAbortController(timeout);

  const mergedOptions: RequestInit = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
    signal: controller.signal,
  };

  try {
    const response = await fetch(url, mergedOptions);

    // Obsługa HTTP 429 (Too Many Requests)
    if (response.status === 429) {
      if (currentAttempt >= maxRetries) {
        throw new Error(`Przekroczono limit zapytań po ${maxRetries} próbach`);
      }

      // Parsuj Retry-After (domyślnie 60s)
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10) || 60;

      logger.warn(
        `HTTP 429${context ? ` (${context})` : ''}. Ponowna próba za ${retryAfter} sekund... (próba ${currentAttempt}/${maxRetries})`,
      );

      // Czekaj dokładnie Retry-After sekund
      await sleep(retryAfter * 1000);

      // Retry
      return httpRequest(url, options, {
        maxRetries,
        currentAttempt: currentAttempt + 1,
        timeout,
        context,
      });
    }

    return response;
  } catch (error: unknown) {
    // Błąd timeoutu
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request timeout po ${timeout}ms: ${url}`);
    }

    // Błędy sieciowe
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
      logger.error(`Błąd sieci: ${err.code}`);
    }
    throw error;
  }
}

/**
 * Wykonuje żądanie GET
 * @param {string} url - URL żądania
 * @param {HeadersInit} headers - Nagłówki HTTP
 * @param {number} timeout - Timeout w ms (domyślnie TIMEOUTS.DEFAULT)
 * @returns {Promise<Response>} Odpowiedź HTTP
 * @throws {Error} Gdy wystąpił błąd zapytania
 */
export async function get(
  url: string,
  headers: HeadersInit = {},
  timeout: number = TIMEOUTS.DEFAULT,
): Promise<Response> {
  return httpRequest(url, { method: 'GET', headers }, { timeout });
}

/**
 * Wykonuje żądanie POST z body JSON
 * @param {string} url - URL żądania
 * @param {unknown} body - Dane do wysłania (będą serializowane do JSON)
 * @param {HeadersInit} headers - Nagłówki HTTP
 * @param {number} timeout - Timeout w ms (domyślnie TIMEOUTS.DEFAULT)
 * @returns {Promise<Response>} Odpowiedź HTTP
 * @throws {Error} Gdy wystąpił błąd zapytania
 */
export async function post(
  url: string,
  body: unknown,
  headers: HeadersInit = {},
  timeout: number = TIMEOUTS.DEFAULT,
): Promise<Response> {
  return httpRequest(
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    { timeout },
  );
}
