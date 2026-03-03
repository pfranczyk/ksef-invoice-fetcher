/**
 * Walidacja danych wejściowych
 */

/**
 * Wagi dla walidacji sumy kontrolnej NIP
 */
const NIP_WEIGHTS = Object.freeze<number[]>([6, 5, 7, 2, 3, 4, 5, 6, 7]);

/**
 * Waliduje format i sumę kontrolną NIP
 * @param {string} nip - Numer NIP do walidacji
 * @returns {boolean} true jeśli NIP jest poprawny
 * @throws {Error} Jeśli NIP jest niepoprawny
 */
export function validateNIP(nip: string): boolean {
  // Walidacja formatu - dokładnie 10 cyfr
  if (!/^\d{10}$/.test(nip)) {
    throw new Error('NIP musi mieć dokładnie 10 cyfr');
  }

  // Konwersja na tablicę cyfr
  const digits = nip.split('').map((d: string) => parseInt(d, 10));

  // Obliczenie sumy kontrolnej
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += digits[i] * NIP_WEIGHTS[i];
  }

  // Reszta z dzielenia przez 11
  const remainder = sum % 11;

  // Oczekiwana suma kontrolna (jeśli reszta = 10, to suma kontrolna = 0)
  const expectedChecksum = remainder === 10 ? 0 : remainder;

  // Porównanie z 10. cyfrą
  if (digits[9] !== expectedChecksum) {
    throw new Error(`Nieprawidłowa suma kontrolna NIP. Oczekiwano ${expectedChecksum}, otrzymano ${digits[9]}`);
  }

  return true;
}

/**
 * Typ wyniku walidacji zakresu dat
 */
export type TValidateDateRangeReturn = {
  readonly from: Date;
  readonly to: Date;
};

/**
 * Waliduje zakres dat
 * @param {string} dateFrom - Data początkowa (format: YYYY-MM-DD)
 * @param {string} dateTo - Data końcowa (format: YYYY-MM-DD)
 * @returns {TValidateDateRangeReturn} Obiekt z sparsowanymi datami { from: Date, to: Date }
 * @throws {Error} Jeśli daty są niepoprawne
 */
export function validateDateRange(dateFrom: string, dateTo: string): TValidateDateRangeReturn {
  // Parsowanie dat
  const from = new Date(dateFrom);
  const to = new Date(dateTo);

  // Sprawdzenie poprawności dat
  if (Number.isNaN(from.getTime())) {
    throw new Error(`Nieprawidłowy format daty dateFrom: "${dateFrom}". Użyj YYYY-MM-DD`);
  }

  if (Number.isNaN(to.getTime())) {
    throw new Error(`Nieprawidłowy format daty dateTo: "${dateTo}". Użyj YYYY-MM-DD`);
  }

  // Sprawdzenie kolejności dat
  if (from > to) {
    throw new Error('dateFrom musi być wcześniejsza lub równa dateTo');
  }

  // Walidacja granic miesiąca (wymaganie biznesowe MVP v1)
  const fromMonth = from.getMonth();
  const fromYear = from.getFullYear();
  const toMonth = to.getMonth();
  const toYear = to.getFullYear();

  if (fromMonth !== toMonth || fromYear !== toYear) {
    throw new Error(
      `Zakres dat musi mieścić się w jednym miesiącu.\n` +
        `Podano: ${dateFrom} do ${dateTo} (przekroczenie granicy miesiąca).\n` +
        `Przykład: --df 2026-01-01 --dt 2026-01-31`,
    );
  }

  return { from, to };
}

/**
 * Parsuje skrócony format miesiąca (YYYY-MM) na pełny zakres dat
 * @param {string} monthStr - Miesiąc w formacie YYYY-MM
 * @returns {TValidateDateRangeReturn} Obiekt z pierwszym i ostatnim dniem miesiąca { from: Date, to: Date }
 * @throws {Error} Jeśli format jest niepoprawny
 */
export function parseMonthToDateRange(monthStr: string): TValidateDateRangeReturn {
  if (!/^\d{4}-\d{2}$/.test(monthStr)) {
    throw new Error(`Nieprawidłowy format miesiąca: "${monthStr}". Użyj YYYY-MM (np. 2026-02)`);
  }

  const [yearStr, monthNumStr] = monthStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10);

  if (month < 1 || month > 12) {
    throw new Error(`Nieprawidłowy miesiąc: ${month}. Miesiąc musi być w zakresie 1-12`);
  }

  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0); // dzień 0 następnego miesiąca = ostatni dzień bieżącego

  return { from, to };
}

/**
 * Konwertuje datę na format ISO 8601 z czasem (dla API KSeF)
 * @param {Date} date - Obiekt Date
 * @param {boolean} isEndOfDay - Czy ustawić koniec dnia (23:59:59)
 * @returns {string} Data w formacie ISO 8601
 */
export function toISODateTimeString(date: Date, isEndOfDay: boolean = false): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  if (isEndOfDay) {
    return `${year}-${month}-${day}T23:59:59Z`;
  }

  return `${year}-${month}-${day}T00:00:00Z`;
}

/**
 * Waliduje ścieżkę pliku/katalogu (zabezpieczenie przed path traversal)
 * @param {string} path - Ścieżka do walidacji
 * @param {string} paramName - Nazwa parametru (do komunikatu błędu)
 * @returns {boolean} true jeśli ścieżka jest poprawna
 * @throws {Error} Jeśli ścieżka zawiera niebezpieczne wzorce
 */
export function validatePath(path: string, paramName: string = 'path'): boolean {
  if (!path) {
    throw new Error(`${paramName} musi być niepustym stringiem`);
  }

  // Zabezpieczenie przed path traversal
  const dangerousPatterns = ['../', '..\\', '%2e%2e', '%252e'];
  for (const pattern of dangerousPatterns) {
    if (path.toLowerCase().includes(pattern)) {
      throw new Error(`${paramName} zawiera niebezpieczny wzorzec path traversal: ${pattern}`);
    }
  }

  return true;
}

/**
 * Waliduje URL
 * @param {string} url - URL do walidacji
 * @param {string} paramName - Nazwa parametru (do komunikatu błędu)
 * @returns {boolean} true jeśli URL jest poprawny
 * @throws {Error} Jeśli URL jest niepoprawny
 */
export function validateURL(url: string, paramName: string = 'URL'): boolean {
  if (!url) {
    throw new Error(`${paramName} musi być niepustym stringiem`);
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`${paramName} musi używać protokołu HTTP lub HTTPS`);
    }
  } catch (error: unknown) {
    const err = error as Error;
    throw new Error(`Nieprawidłowy format ${paramName}: ${err.message}`);
  }

  return true;
}
