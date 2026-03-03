import { describe, expect, it } from 'vitest';
import {
  parseMonthToDateRange,
  toISODateTimeString,
  validateDateRange,
  validateNIP,
  validatePath,
  validateURL,
} from '../validator.ts';

// ---------------------------------------------------------------------------
// validateNIP
// ---------------------------------------------------------------------------

describe('validateNIP', () => {
  it('powinien zaakceptować poprawny NIP z właściwą sumą kontrolną', () => {
    expect(validateNIP('5252674798')).toBe(true); // Allegro sp. z o.o.
  });

  it('powinien zaakceptować inny poprawny NIP', () => {
    expect(validateNIP('5260001246')).toBe(true);
  });

  it('powinien rzucić błąd gdy NIP ma mniej niż 10 cyfr', () => {
    expect(() => validateNIP('123456789')).toThrow('NIP musi mieć dokładnie 10 cyfr');
  });

  it('powinien rzucić błąd gdy NIP ma więcej niż 10 cyfr', () => {
    expect(() => validateNIP('12345678901')).toThrow('NIP musi mieć dokładnie 10 cyfr');
  });

  it('powinien rzucić błąd gdy NIP zawiera litery', () => {
    expect(() => validateNIP('525267479X')).toThrow('NIP musi mieć dokładnie 10 cyfr');
  });

  it('powinien rzucić błąd gdy NIP ma błędną sumę kontrolną', () => {
    // NIP Allegro (5252674798) z ostatnią cyfrą zmienioną z 8 na 7 → błędna suma kontrolna
    expect(() => validateNIP('5252674797')).toThrow('Nieprawidłowa suma kontrolna NIP');
  });

  it('powinien rzucić błąd dla pustego stringa', () => {
    expect(() => validateNIP('')).toThrow('NIP musi mieć dokładnie 10 cyfr');
  });
});

// ---------------------------------------------------------------------------
// validateDateRange
// ---------------------------------------------------------------------------

describe('validateDateRange', () => {
  it('powinien zaakceptować prawidłowy zakres dat w tym samym miesiącu', () => {
    const result = validateDateRange('2026-02-01', '2026-02-28');
    expect(result.from).toEqual(new Date('2026-02-01'));
    expect(result.to).toEqual(new Date('2026-02-28'));
  });

  it('powinien zaakceptować ten sam dzień jako from i to', () => {
    const result = validateDateRange('2026-02-15', '2026-02-15');
    expect(result.from).toEqual(new Date('2026-02-15'));
    expect(result.to).toEqual(new Date('2026-02-15'));
  });

  it('powinien rzucić błąd gdy from jest późniejsze niż to', () => {
    expect(() => validateDateRange('2026-02-28', '2026-02-01')).toThrow(
      'dateFrom musi być wcześniejsza lub równa dateTo',
    );
  });

  it('powinien rzucić błąd gdy zakres przekracza granicę miesiąca', () => {
    expect(() => validateDateRange('2026-01-31', '2026-02-01')).toThrow(
      'Zakres dat musi mieścić się w jednym miesiącu',
    );
  });

  it('powinien rzucić błąd gdy dateFrom ma nieprawidłowy format', () => {
    expect(() => validateDateRange('abc', '2026-02-28')).toThrow('Nieprawidłowy format daty dateFrom');
  });

  it('powinien rzucić błąd gdy dateTo ma nieprawidłowy format', () => {
    expect(() => validateDateRange('2026-02-01', 'xyz')).toThrow('Nieprawidłowy format daty dateTo');
  });
});

// ---------------------------------------------------------------------------
// parseMonthToDateRange
// ---------------------------------------------------------------------------

describe('parseMonthToDateRange', () => {
  it('powinien zwrócić pierwszy i ostatni dzień lutego 2026', () => {
    const result = parseMonthToDateRange('2026-02');
    expect(result.from).toEqual(new Date(2026, 1, 1));
    expect(result.to).toEqual(new Date(2026, 1, 28));
  });

  it('powinien zwrócić 29 dni dla lutego w roku przestępnym', () => {
    const result = parseMonthToDateRange('2024-02');
    expect(result.from).toEqual(new Date(2024, 1, 1));
    expect(result.to).toEqual(new Date(2024, 1, 29));
  });

  it('powinien zwrócić 31 dni dla stycznia', () => {
    const result = parseMonthToDateRange('2026-01');
    expect(result.from).toEqual(new Date(2026, 0, 1));
    expect(result.to).toEqual(new Date(2026, 0, 31));
  });

  it('powinien rzucić błąd gdy miesiąc wynosi 13', () => {
    expect(() => parseMonthToDateRange('2026-13')).toThrow('Nieprawidłowy miesiąc: 13');
  });

  it('powinien rzucić błąd gdy miesiąc wynosi 0', () => {
    expect(() => parseMonthToDateRange('2026-00')).toThrow('Nieprawidłowy miesiąc: 0');
  });

  it('powinien rzucić błąd gdy format to YYYY-M zamiast YYYY-MM', () => {
    expect(() => parseMonthToDateRange('2026-2')).toThrow('Nieprawidłowy format miesiąca');
  });

  it('powinien rzucić błąd dla całkowicie błędnego formatu', () => {
    expect(() => parseMonthToDateRange('abc')).toThrow('Nieprawidłowy format miesiąca');
  });
});

// ---------------------------------------------------------------------------
// toISODateTimeString
// ---------------------------------------------------------------------------

describe('toISODateTimeString', () => {
  it('powinien zwrócić datę z godziną 00:00:00Z gdy isEndOfDay=false', () => {
    const date = new Date(2026, 1, 8); // 2026-02-08 (miesiące 0-indexed)
    expect(toISODateTimeString(date, false)).toBe('2026-02-08T00:00:00Z');
  });

  it('powinien zwrócić datę z godziną 23:59:59Z gdy isEndOfDay=true', () => {
    const date = new Date(2026, 1, 8);
    expect(toISODateTimeString(date, true)).toBe('2026-02-08T23:59:59Z');
  });

  it('powinien domyślnie używać początku dnia gdy isEndOfDay nie podano', () => {
    const date = new Date(2026, 0, 1); // 2026-01-01
    expect(toISODateTimeString(date)).toBe('2026-01-01T00:00:00Z');
  });

  it('powinien poprawnie formatować miesiąc i dzień z zerem wiodącym', () => {
    const date = new Date(2026, 0, 5); // 2026-01-05
    expect(toISODateTimeString(date)).toBe('2026-01-05T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// validatePath
// ---------------------------------------------------------------------------

describe('validatePath', () => {
  it('powinien zaakceptować poprawną ścieżkę bezwzględną', () => {
    expect(validatePath('/some/valid/path')).toBe(true);
  });

  it('powinien zaakceptować poprawną ścieżkę względną', () => {
    expect(validatePath('output/invoices')).toBe(true);
  });

  it('powinien rzucić błąd gdy ścieżka zawiera ../', () => {
    expect(() => validatePath('../secret')).toThrow('zawiera niebezpieczny wzorzec path traversal: ../');
  });

  it('powinien rzucić błąd gdy ścieżka zawiera ..\\', () => {
    expect(() => validatePath('..\\secret')).toThrow('zawiera niebezpieczny wzorzec path traversal');
  });

  it('powinien rzucić błąd gdy ścieżka zawiera %2e%2e (URL-encoded)', () => {
    expect(() => validatePath('%2e%2e/secret')).toThrow('zawiera niebezpieczny wzorzec path traversal: %2e%2e');
  });

  it('powinien rzucić błąd gdy ścieżka zawiera %252e (double-encoded)', () => {
    expect(() => validatePath('%252e%252esecret')).toThrow('zawiera niebezpieczny wzorzec path traversal: %252e');
  });

  it('powinien rzucić błąd dla pustego stringa', () => {
    expect(() => validatePath('')).toThrow('musi być niepustym stringiem');
  });

  it('powinien używać nazwy parametru w komunikacie błędu', () => {
    expect(() => validatePath('', 'certPath')).toThrow('certPath musi być niepustym stringiem');
  });
});

// ---------------------------------------------------------------------------
// validateURL
// ---------------------------------------------------------------------------

describe('validateURL', () => {
  it('powinien zaakceptować poprawny URL z protokołem https', () => {
    expect(validateURL('https://api.ksef.mf.gov.pl')).toBe(true);
  });

  it('powinien zaakceptować poprawny URL z protokołem http', () => {
    expect(validateURL('http://api-test.ksef.mf.gov.pl')).toBe(true);
  });

  it('powinien rzucić błąd dla protokołu ftp', () => {
    expect(() => validateURL('ftp://somewhere.com')).toThrow('musi używać protokołu HTTP lub HTTPS');
  });

  it('powinien rzucić błąd dla tekstu który nie jest URL-em', () => {
    expect(() => validateURL('not-a-url')).toThrow('Nieprawidłowy format');
  });

  it('powinien rzucić błąd dla pustego stringa', () => {
    expect(() => validateURL('')).toThrow('musi być niepustym stringiem');
  });
});
