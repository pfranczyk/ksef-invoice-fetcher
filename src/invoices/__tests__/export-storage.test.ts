import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '../../types.ts';
import { unpackAndStoreInvoices } from '../export-storage.ts';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockFns = vi.hoisted(() => ({
  extractZipEntries: vi.fn(),
  createDirectory: vi.fn(),
  writeBinaryFile: vi.fn(),
}));

vi.mock('../export-zip.ts', () => ({
  extractZipEntries: mockFns.extractZipEntries,
}));

vi.mock('../../utils/file-system.ts', () => ({
  createDirectory: mockFns.createDirectory,
  writeBinaryFile: mockFns.writeBinaryFile,
}));

// --------------------------------------------------------------------------
// Stałe testowe
// --------------------------------------------------------------------------

const OUTPUT_DIR = '/output';
const MONTH_FOLDER = '2026-01';
const TARGET_DIR = join(OUTPUT_DIR, MONTH_FOLDER);

const MOCK_LOGGER: ILogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const ZIP_BUFFER = Buffer.from('placeholder-zip');

const XML_1 = Buffer.from('<Invoice id="1"/>');
const XML_2 = Buffer.from('<Invoice id="2"/>');

function makeMetadataBuffer(invoices: unknown[]): Buffer {
  return Buffer.from(JSON.stringify({ invoices }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFns.createDirectory.mockResolvedValue(undefined);
  mockFns.writeBinaryFile.mockResolvedValue(undefined);
});

// --------------------------------------------------------------------------
// unpackAndStoreInvoices
// --------------------------------------------------------------------------

describe('unpackAndStoreInvoices', () => {
  it('powinien rozpakować ZIP i zapisać 2 faktury XML z poprawnym wynikiem', async () => {
    mockFns.extractZipEntries.mockReturnValue([
      { name: 'faktura1.xml', isDirectory: false, content: XML_1 },
      { name: 'faktura2.xml', isDirectory: false, content: XML_2 },
      { name: '_metadata.json', isDirectory: false, content: makeMetadataBuffer([{}, {}]) },
    ]);

    const result = await unpackAndStoreInvoices({
      zipBuffer: ZIP_BUFFER,
      outputBaseDir: OUTPUT_DIR,
      monthFolder: MONTH_FOLDER,
      logger: MOCK_LOGGER,
    });

    expect(result.invoiceCount).toBe(2);
    expect(result.metadataCount).toBe(2);
    expect(result.targetDir).toBe(TARGET_DIR);
    expect(result.inconsistentMetadata).toBe(false);
  });

  it('powinien utworzyć katalog docelowy i zapisać pliki na dysk', async () => {
    mockFns.extractZipEntries.mockReturnValue([
      { name: 'faktura1.xml', isDirectory: false, content: XML_1 },
      { name: '_metadata.json', isDirectory: false, content: makeMetadataBuffer([{}]) },
    ]);

    await unpackAndStoreInvoices({
      zipBuffer: ZIP_BUFFER,
      outputBaseDir: OUTPUT_DIR,
      monthFolder: MONTH_FOLDER,
      logger: MOCK_LOGGER,
    });

    expect(mockFns.createDirectory).toHaveBeenCalledWith(TARGET_DIR);
    // 1 plik XML + 1 _metadata.json = 2 zapisy
    expect(mockFns.writeBinaryFile).toHaveBeenCalledTimes(2);
    expect(mockFns.writeBinaryFile).toHaveBeenCalledWith(join(TARGET_DIR, 'faktura1.xml'), XML_1);
    expect(mockFns.writeBinaryFile).toHaveBeenCalledWith(join(TARGET_DIR, '_metadata.json'), expect.any(Buffer));
  });

  it('powinien rzucić błąd gdy brak _metadata.json w archiwum', async () => {
    mockFns.extractZipEntries.mockReturnValue([{ name: 'faktura1.xml', isDirectory: false, content: XML_1 }]);

    await expect(
      unpackAndStoreInvoices({
        zipBuffer: ZIP_BUFFER,
        outputBaseDir: OUTPUT_DIR,
        monthFolder: MONTH_FOLDER,
        logger: MOCK_LOGGER,
      }),
    ).rejects.toThrow('Brak pliku _metadata.json w archiwum ZIP');

    expect(mockFns.createDirectory).not.toHaveBeenCalled();
  });

  it('powinien rzucić błąd gdy _metadata.json zawiera nieprawidłowy JSON', async () => {
    mockFns.extractZipEntries.mockReturnValue([
      { name: '_metadata.json', isDirectory: false, content: Buffer.from('INVALID JSON{{{') },
    ]);

    await expect(
      unpackAndStoreInvoices({
        zipBuffer: ZIP_BUFFER,
        outputBaseDir: OUTPUT_DIR,
        monthFolder: MONTH_FOLDER,
        logger: MOCK_LOGGER,
      }),
    ).rejects.toThrow('Nie udało się sparsować _metadata.json:');
  });

  it('powinien rzucić błąd gdy metadata.invoices nie jest tablicą', async () => {
    mockFns.extractZipEntries.mockReturnValue([
      { name: '_metadata.json', isDirectory: false, content: Buffer.from(JSON.stringify({ invoices: 'nie-tablica' })) },
    ]);

    await expect(
      unpackAndStoreInvoices({
        zipBuffer: ZIP_BUFFER,
        outputBaseDir: OUTPUT_DIR,
        monthFolder: MONTH_FOLDER,
        logger: MOCK_LOGGER,
      }),
    ).rejects.toThrow('_metadata.json nie jest tablicą');
  });

  it('powinien zwrócić inconsistentMetadata=true gdy liczba XML różni się od liczby rekordów metadanych', async () => {
    mockFns.extractZipEntries.mockReturnValue([
      { name: 'faktura1.xml', isDirectory: false, content: XML_1 },
      { name: '_metadata.json', isDirectory: false, content: makeMetadataBuffer([{}, {}]) }, // 2 rekordy, ale 1 XML
    ]);

    const result = await unpackAndStoreInvoices({
      zipBuffer: ZIP_BUFFER,
      outputBaseDir: OUTPUT_DIR,
      monthFolder: MONTH_FOLDER,
      logger: MOCK_LOGGER,
    });

    expect(result.inconsistentMetadata).toBe(true);
    expect(result.invoiceCount).toBe(1);
    expect(result.metadataCount).toBe(2);
  });

  it('powinien pomijać wpisy będące katalogami przy zliczaniu plików XML', async () => {
    mockFns.extractZipEntries.mockReturnValue([
      { name: 'subdir/', isDirectory: true, content: null },
      { name: 'subdir/faktura1.xml', isDirectory: false, content: XML_1 },
      { name: '_metadata.json', isDirectory: false, content: makeMetadataBuffer([{}]) },
    ]);

    const result = await unpackAndStoreInvoices({
      zipBuffer: ZIP_BUFFER,
      outputBaseDir: OUTPUT_DIR,
      monthFolder: MONTH_FOLDER,
      logger: MOCK_LOGGER,
    });

    expect(result.invoiceCount).toBe(1);
    expect(result.inconsistentMetadata).toBe(false);
  });
});
