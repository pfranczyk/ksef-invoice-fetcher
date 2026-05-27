import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePdfForMonth } from '../pdf-generator.ts';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockFns = vi.hoisted(() => ({
  parseInvoiceXml: vi.fn(),
  mapInvoiceData: vi.fn(),
  buildInvoicePdfDocDefinition: vi.fn(),
  writePdfToFile: vi.fn(),
  createDirectory: vi.fn(),
  fileExists: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('../xml-parser.ts', () => ({
  parseInvoiceXml: mockFns.parseInvoiceXml,
  mapInvoiceData: mockFns.mapInvoiceData,
}));

vi.mock('../pdf-template.ts', () => ({
  buildInvoicePdfDocDefinition: mockFns.buildInvoicePdfDocDefinition,
}));

vi.mock('../pdf-writer.ts', () => ({
  writePdfToFile: mockFns.writePdfToFile,
}));

vi.mock('../../utils/file-system.ts', () => ({
  createDirectory: mockFns.createDirectory,
  fileExists: mockFns.fileExists,
}));

vi.mock('fs', () => ({
  promises: {
    readFile: mockFns.readFile,
  },
}));

vi.mock('../../utils/logger.ts', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  maskSensitiveData: vi.fn((s: string) => s),
}));

// --------------------------------------------------------------------------
// Stałe testowe
// --------------------------------------------------------------------------

const BASE_OPTIONS = {
  month: '2026-01',
  xmlDir: '/xml',
  pdfDir: '/pdf',
};

/**
 * Buduje zawartość _metadata.json
 */
function makeMetadata(invoices: Array<{ ksefNumber: string; issueDate: string }>): string {
  return JSON.stringify({ invoices });
}

/**
 * Konfiguruje mocki do happy path (N faktur)
 */
function setupHappyPath(invoices: Array<{ ksefNumber: string; issueDate: string }>): void {
  mockFns.fileExists.mockResolvedValue(true);
  mockFns.createDirectory.mockResolvedValue(undefined);
  mockFns.readFile.mockResolvedValue(makeMetadata(invoices));
  mockFns.parseInvoiceXml.mockResolvedValue({ Faktura: {} });
  mockFns.mapInvoiceData.mockReturnValue({ numerFaktury: 'FV/001', pozycje: [] });
  mockFns.buildInvoicePdfDocDefinition.mockReturnValue({ content: [] });
  mockFns.writePdfToFile.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------
// generatePdfForMonth
// --------------------------------------------------------------------------

describe('generatePdfForMonth', () => {
  it('powinien wygenerować PDF dla jednej faktury i zwrócić stats success=1', async () => {
    const invoices = [{ ksefNumber: 'KSEF001', issueDate: '2026-01-15' }];
    setupHappyPath(invoices);

    const result = await generatePdfForMonth(BASE_OPTIONS);

    expect(result.total).toBe(1);
    expect(result.success).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('powinien wywołać parseInvoiceXml, buildInvoicePdfDocDefinition i writePdfToFile dla każdej faktury', async () => {
    const invoices = [{ ksefNumber: 'KSEF001', issueDate: '2026-01-15' }];
    setupHappyPath(invoices);

    await generatePdfForMonth(BASE_OPTIONS);

    const xmlMonthDir = join('/xml', '01');
    const pdfMonthDir = join('/pdf', '01');
    expect(mockFns.parseInvoiceXml).toHaveBeenCalledWith(join(xmlMonthDir, 'KSEF001.xml'));
    expect(mockFns.buildInvoicePdfDocDefinition).toHaveBeenCalledOnce();
    expect(mockFns.writePdfToFile).toHaveBeenCalledWith({ content: [] }, join(pdfMonthDir, 'KSEF001.pdf'));
  });

  it('powinien przefiltrować faktury według startDay i endDay', async () => {
    const invoices = [
      { ksefNumber: 'KSEF005', issueDate: '2026-01-05' }, // dzień 5 — w zakresie [1,10]
      { ksefNumber: 'KSEF015', issueDate: '2026-01-15' }, // dzień 15 — poza zakresem
    ];
    setupHappyPath(invoices);

    const result = await generatePdfForMonth({
      ...BASE_OPTIONS,
      startDay: 1,
      endDay: 10,
    });

    expect(result.total).toBe(1); // tylko KSEF005 po filtracji
    expect(result.success).toBe(1);
    expect(mockFns.parseInvoiceXml).toHaveBeenCalledOnce();
    const [calledXmlPath] = mockFns.parseInvoiceXml.mock.calls[0] as [string];
    expect(calledXmlPath).toContain('KSEF005');
  });

  it('powinien zwrócić stats failed=1 gdy writePdfToFile rzuci błąd i nie przerywać', async () => {
    const invoices = [
      { ksefNumber: 'KSEF001', issueDate: '2026-01-01' },
      { ksefNumber: 'KSEF002', issueDate: '2026-01-02' },
    ];
    setupHappyPath(invoices);
    // Pierwsza faktura rzuca błąd, druga przechodzi normalnie
    mockFns.writePdfToFile.mockRejectedValueOnce(new Error('Błąd zapisu PDF')).mockResolvedValueOnce(undefined);

    const result = await generatePdfForMonth(BASE_OPTIONS);

    expect(result.total).toBe(2);
    expect(result.success).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].file).toBe('KSEF001');
    expect(result.errors[0].error).toBe('Błąd zapisu PDF');
  });

  it('powinien zwiększyć skipped gdy plik XML faktury nie istnieje', async () => {
    const invoices = [{ ksefNumber: 'KSEF999', issueDate: '2026-01-10' }];
    setupHappyPath(invoices);
    mockFns.fileExists
      .mockResolvedValueOnce(true) // xmlMonthDir istnieje
      .mockResolvedValueOnce(true) // metadataPath istnieje
      .mockResolvedValueOnce(false); // xmlPath nie istnieje

    const result = await generatePdfForMonth(BASE_OPTIONS);

    expect(result.total).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.success).toBe(0);
    expect(mockFns.buildInvoicePdfDocDefinition).not.toHaveBeenCalled();
  });

  it('powinien rzucić błąd gdy format miesiąca jest nieprawidłowy', async () => {
    await expect(generatePdfForMonth({ ...BASE_OPTIONS, month: '2026-13' })).rejects.toThrow(
      'Nieprawidłowy format miesiąca: 2026-13',
    );
  });

  it('powinien rzucić błąd gdy dzień początkowy jest poza zakresem 1-31', async () => {
    await expect(generatePdfForMonth({ ...BASE_OPTIONS, startDay: 32 })).rejects.toThrow(
      'Nieprawidłowy dzień początkowy: 32',
    );
  });

  it('powinien rzucić błąd gdy dzień początkowy jest większy niż dzień końcowy', async () => {
    await expect(generatePdfForMonth({ ...BASE_OPTIONS, startDay: 20, endDay: 10 })).rejects.toThrow(
      'Dzień początkowy (20) nie może być większy niż dzień końcowy (10)',
    );
  });

  it('powinien rzucić błąd gdy katalog faktur nie istnieje', async () => {
    mockFns.fileExists.mockResolvedValue(false);

    const xmlMonthDir = join('/xml', '01');
    await expect(generatePdfForMonth(BASE_OPTIONS)).rejects.toThrow(`Nie znaleziono katalogu faktur: ${xmlMonthDir}`);
  });

  it('powinien zwrócić pusty wynik gdy brak faktur po filtrowaniu', async () => {
    const invoices = [
      { ksefNumber: 'KSEF020', issueDate: '2026-01-20' }, // dzień 20 — poza [1,10]
    ];
    setupHappyPath(invoices);

    const result = await generatePdfForMonth({
      ...BASE_OPTIONS,
      startDay: 1,
      endDay: 10,
    });

    expect(result.total).toBe(0);
    expect(result.success).toBe(0);
    expect(mockFns.buildInvoicePdfDocDefinition).not.toHaveBeenCalled();
  });
});
