import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePdfForMonth } from '../pdf-generator.ts';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockFns = vi.hoisted(() => ({
  parseInvoiceXml: vi.fn(),
  mapInvoiceData: vi.fn(),
  processTemplate: vi.fn(),
  validateTemplate: vi.fn(),
  convertDocxToPdf: vi.fn(),
  createDirectory: vi.fn(),
  deleteFile: vi.fn(),
  fileExists: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  rmdir: vi.fn(),
}));

vi.mock('../xml-parser.ts', () => ({
  parseInvoiceXml: mockFns.parseInvoiceXml,
  mapInvoiceData: mockFns.mapInvoiceData,
}));

vi.mock('../template-processor.ts', () => ({
  processTemplate: mockFns.processTemplate,
  validateTemplate: mockFns.validateTemplate,
}));

vi.mock('../docx-to-pdf.ts', () => ({
  convertDocxToPdf: mockFns.convertDocxToPdf,
}));

vi.mock('../../utils/file-system.ts', () => ({
  createDirectory: mockFns.createDirectory,
  deleteFile: mockFns.deleteFile,
  fileExists: mockFns.fileExists,
}));

vi.mock('fs', () => ({
  promises: {
    readFile: mockFns.readFile,
    readdir: mockFns.readdir,
    rmdir: mockFns.rmdir,
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
  outputDir: '/output',
  templatePath: '/templates/invoice.docx',
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
  mockFns.validateTemplate.mockResolvedValue(true);
  mockFns.readFile.mockResolvedValue(makeMetadata(invoices));
  mockFns.parseInvoiceXml.mockResolvedValue({ Faktura: {} });
  mockFns.mapInvoiceData.mockReturnValue({ numerFaktury: 'FV/001', pozycje: [] });
  mockFns.processTemplate.mockResolvedValue(undefined);
  mockFns.convertDocxToPdf.mockResolvedValue(undefined);
  mockFns.deleteFile.mockResolvedValue(undefined);
  mockFns.readdir.mockResolvedValue([]);
  mockFns.rmdir.mockResolvedValue(undefined);
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

  it('powinien wywołać parseInvoiceXml i processTemplate dla każdej faktury', async () => {
    const invoices = [{ ksefNumber: 'KSEF001', issueDate: '2026-01-15' }];
    setupHappyPath(invoices);

    await generatePdfForMonth(BASE_OPTIONS);

    const monthDir = join('/output', '01');
    expect(mockFns.parseInvoiceXml).toHaveBeenCalledWith(join(monthDir, 'KSEF001.xml'));
    expect(mockFns.processTemplate).toHaveBeenCalledOnce();
    expect(mockFns.convertDocxToPdf).toHaveBeenCalledOnce();
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

  it('powinien zwrócić stats failed=1 gdy processTemplate rzuci błąd i nie przerywać', async () => {
    const invoices = [
      { ksefNumber: 'KSEF001', issueDate: '2026-01-01' },
      { ksefNumber: 'KSEF002', issueDate: '2026-01-02' },
    ];
    setupHappyPath(invoices);
    // Pierwsza faktura rzuca błąd, druga przechodzi normalnie
    mockFns.processTemplate.mockRejectedValueOnce(new Error('Błąd szablonu')).mockResolvedValueOnce(undefined);

    const result = await generatePdfForMonth(BASE_OPTIONS);

    expect(result.total).toBe(2);
    expect(result.success).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].file).toBe('KSEF001');
    expect(result.errors[0].error).toBe('Błąd szablonu');
  });

  it('powinien zwiększyć skipped gdy plik XML faktury nie istnieje', async () => {
    const invoices = [{ ksefNumber: 'KSEF999', issueDate: '2026-01-10' }];
    setupHappyPath(invoices);
    // Drugi wywołanie fileExists (dla xmlPath) zwraca false
    mockFns.fileExists
      .mockResolvedValueOnce(true) // monthDir istnieje
      .mockResolvedValueOnce(true) // metadataPath istnieje
      .mockResolvedValueOnce(false); // xmlPath nie istnieje

    const result = await generatePdfForMonth(BASE_OPTIONS);

    expect(result.total).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.success).toBe(0);
    expect(mockFns.processTemplate).not.toHaveBeenCalled();
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
    mockFns.fileExists.mockResolvedValue(false); // katalog nie istnieje

    const monthDir = join('/output', '01');
    await expect(generatePdfForMonth(BASE_OPTIONS)).rejects.toThrow(`Nie znaleziono katalogu faktur: ${monthDir}`);
  });

  it('powinien rzucić błąd gdy szablon nie jest prawidłowy', async () => {
    mockFns.fileExists.mockResolvedValue(true);
    mockFns.createDirectory.mockResolvedValue(undefined);
    mockFns.validateTemplate.mockResolvedValue(false); // nieprawidłowy szablon

    await expect(generatePdfForMonth(BASE_OPTIONS)).rejects.toThrow(
      'Nieprawidłowy lub uszkodzony plik szablonu: /templates/invoice.docx',
    );
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
    expect(mockFns.processTemplate).not.toHaveBeenCalled();
  });
});
