import AdmZip from 'adm-zip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger, IPackageInfo } from '../../types.ts';
import { assembleAndValidateZip, extractZipEntries } from '../export-zip.ts';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Tworzy bufor ZIP z podanymi wpisami (używa realnego adm-zip)
 */
function makeZipBuffer(entries: Array<{ name: string; content: string }>): Buffer {
  const zip = new AdmZip();
  for (const { name, content } of entries) {
    zip.addFile(name, Buffer.from(content, 'utf-8'));
  }
  return zip.toBuffer();
}

// --------------------------------------------------------------------------
// Stałe testowe
// --------------------------------------------------------------------------

const MOCK_LOGGER: ILogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------
// assembleAndValidateZip
// --------------------------------------------------------------------------

describe('assembleAndValidateZip', () => {
  it('powinien scalić dwie części i zwrócić prawidłowy bufor ZIP', () => {
    const zipBuffer = makeZipBuffer([{ name: 'faktura.xml', content: '<Invoice/>' }]);
    const mid = Math.floor(zipBuffer.length / 2);
    const part1 = zipBuffer.subarray(0, mid);
    const part2 = zipBuffer.subarray(mid);

    const packageInfo: IPackageInfo = {
      invoiceCount: 1,
      size: zipBuffer.length,
      parts: [
        { ordinalNumber: 1, url: 'https://example.com/p1', method: 'GET', partSize: part1.length },
        { ordinalNumber: 2, url: 'https://example.com/p2', method: 'GET', partSize: part2.length },
      ],
    };

    const result = assembleAndValidateZip({ decryptedParts: [part1, part2], packageInfo, logger: MOCK_LOGGER });

    expect(result).toEqual(zipBuffer);
    expect(result.length).toBe(zipBuffer.length);
  });

  it('powinien rzucić błąd gdy sumaryczny rozmiar części nie zgadza się z oczekiwanym', () => {
    const zipBuffer = makeZipBuffer([{ name: 'faktura.xml', content: '<Invoice/>' }]);
    const wrongExpectedSize = zipBuffer.length + 100;

    const packageInfo: IPackageInfo = {
      invoiceCount: 1,
      size: wrongExpectedSize,
      parts: [{ ordinalNumber: 1, url: 'https://example.com/p1', method: 'GET', partSize: wrongExpectedSize }],
    };

    expect(() => assembleAndValidateZip({ decryptedParts: [zipBuffer], packageInfo, logger: MOCK_LOGGER })).toThrow(
      `Niezgodność rozmiaru paczki: oczekiwano ${wrongExpectedSize} bajtów, otrzymano ${zipBuffer.length} bajtów`,
    );
  });

  it('powinien rzucić błąd gdy scalony bufor nie zaczyna się od sygnatury ZIP (błędne magic bytes)', () => {
    const nonZipData = Buffer.from('to-nie-jest-zip-brak-magic-bytes');

    const packageInfo: IPackageInfo = {
      invoiceCount: 0,
      size: nonZipData.length,
      parts: [{ ordinalNumber: 1, url: 'https://example.com/p1', method: 'GET', partSize: nonZipData.length }],
    };

    expect(() => assembleAndValidateZip({ decryptedParts: [nonZipData], packageInfo, logger: MOCK_LOGGER })).toThrow(
      'Scalony plik nie jest prawidłowym archiwum ZIP (błędne magic bytes)',
    );
  });
});

// --------------------------------------------------------------------------
// extractZipEntries
// --------------------------------------------------------------------------

describe('extractZipEntries', () => {
  it('powinien zwrócić listę wpisów pliku ZIP z poprawną nazwą i zawartością', () => {
    const zipBuffer = makeZipBuffer([
      { name: 'faktura1.xml', content: '<Invoice id="1"/>' },
      { name: 'faktura2.xml', content: '<Invoice id="2"/>' },
    ]);

    const entries = extractZipEntries(zipBuffer);

    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('faktura1.xml');
    expect(entries[0].isDirectory).toBe(false);
    expect(entries[0].content?.toString('utf-8')).toBe('<Invoice id="1"/>');
    expect(entries[1].name).toBe('faktura2.xml');
    expect(entries[1].isDirectory).toBe(false);
    expect(entries[1].content?.toString('utf-8')).toBe('<Invoice id="2"/>');
  });

  it('powinien zwrócić content=null i isDirectory=true dla wpisów katalogu', () => {
    const zip = new AdmZip();
    zip.addFile('katalog/', Buffer.alloc(0));
    zip.addFile('katalog/plik.xml', Buffer.from('<x/>'));
    const zipBuffer = zip.toBuffer();

    const entries = extractZipEntries(zipBuffer);

    const dirEntry = entries.find((e) => e.name === 'katalog/');
    expect(dirEntry).toBeDefined();
    expect(dirEntry!.isDirectory).toBe(true);
    expect(dirEntry!.content).toBeNull();
  });

  it('powinien zwrócić pustą tablicę dla pustego archiwum ZIP', () => {
    const zip = new AdmZip();
    const zipBuffer = zip.toBuffer();

    const entries = extractZipEntries(zipBuffer);

    expect(entries).toHaveLength(0);
  });
});
