import { describe, expect, it } from 'vitest';
import { maskSensitiveData } from '../logger.ts';

describe('maskSensitiveData', () => {
  it('powinien zwrócić (brak) dla null', () => {
    expect(maskSensitiveData(null)).toBe('(brak)');
  });

  it('powinien zwrócić (brak) dla undefined', () => {
    expect(maskSensitiveData(undefined)).toBe('(brak)');
  });

  it('powinien zwrócić (brak) dla pustego stringa', () => {
    expect(maskSensitiveData('')).toBe('(brak)');
  });

  it('powinien zwrócić **** gdy string jest krótszy lub równy visibleChars', () => {
    expect(maskSensitiveData('abc', 4)).toBe('****');
    expect(maskSensitiveData('abcd', 4)).toBe('****');
  });

  it('powinien pokazać pierwsze 4 znaki i zamaskować resztę gwiazdkami', () => {
    // 'eyJhbGciOiJSUzI1NiJ9.payload.signature' → 4 widoczne + max 20 gwiazdek
    const result = maskSensitiveData('eyJhbGciOiJSUzI1NiJ9.payload.signature');
    expect(result).toBe('eyJh********************');
  });

  it('powinien ograniczyć maskę do maksymalnie 20 gwiazdek niezależnie od długości stringa', () => {
    // 4 widoczne znaki + 100 znaków do zamaskowania → cap na 20 gwiazdkach
    const longToken = `abcd${'x'.repeat(100)}`;
    expect(maskSensitiveData(longToken)).toBe('abcd********************');
  });

  it('powinien respektować niestandardową liczbę widocznych znaków', () => {
    // visibleChars=2 → 'AB' widoczne, 'CDEFGH' (6 znaków) zamaskowane
    expect(maskSensitiveData('ABCDEFGH', 2)).toBe('AB******');
  });

  it('powinien pokazać dokładnie tyle gwiazdek ile zamaskowanych znaków (gdy krótki token)', () => {
    // 'abcdefgh' — 4 widoczne, 4 zamaskowane (mniej niż 20)
    const result = maskSensitiveData('abcdefgh');
    expect(result).toBe('abcd****');
  });
});
