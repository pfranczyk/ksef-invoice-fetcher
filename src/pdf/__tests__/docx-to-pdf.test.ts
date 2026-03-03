import { dirname, join, parse } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertDocxToPdf, convertMultipleDocxToPdf } from '../docx-to-pdf.ts';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockFns = vi.hoisted(() => ({
  exec: vi.fn(),
  access: vi.fn(),
  rename: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: mockFns.exec,
}));

vi.mock('fs', () => ({
  promises: {
    access: mockFns.access,
    rename: mockFns.rename,
  },
}));

vi.mock('../../config/env.ts', () => ({
  getConfig: mockFns.getConfig,
}));

vi.mock('../../utils/logger.ts', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  maskSensitiveData: vi.fn((s: string) => s),
}));

// --------------------------------------------------------------------------
// Stałe testowe
// --------------------------------------------------------------------------

const LIBRE_OFFICE_PATH = '/usr/bin/soffice';

const MOCK_CONFIG = {
  libreOfficePath: LIBRE_OFFICE_PATH,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFns.getConfig.mockReturnValue(MOCK_CONFIG);
  mockFns.access.mockResolvedValue(undefined);
  mockFns.rename.mockResolvedValue(undefined);
  // exec musi wywołać callback — promisify wymaga konwencji (err, stdout, stderr)
  mockFns.exec.mockImplementation(
    (_cmd: string, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, 'converting...', '');
    },
  );
});

// --------------------------------------------------------------------------
// convertDocxToPdf
// --------------------------------------------------------------------------

describe('convertDocxToPdf', () => {
  it('powinien wywołać LibreOffice z poprawną komendą i zwrócić void', async () => {
    // Ścieżki dają tę samą nazwę — bez zmiany nazwy pliku
    await convertDocxToPdf('/tmp/invoice.docx', '/tmp/invoice.pdf');

    expect(mockFns.exec).toHaveBeenCalledOnce();
    const [cmd] = mockFns.exec.mock.calls[0] as [string];
    expect(cmd).toContain(LIBRE_OFFICE_PATH);
    expect(cmd).toContain('--headless');
    expect(cmd).toContain('--convert-to pdf');
    expect(cmd).toContain('invoice.docx');
  });

  it('powinien wywołać fs.rename gdy LibreOffice generuje inną nazwę pliku', async () => {
    // docxPath = /tmp/orig.docx → LibreOffice generuje orig.pdf w katalogu pdfPath
    // pdfPath = /out/renamed.pdf → rename potrzebne
    const docxPath = '/tmp/orig.docx';
    const pdfPath = '/out/renamed.pdf';
    const expectedPdf = join(dirname(pdfPath), `${parse(docxPath).name}.pdf`);

    await convertDocxToPdf(docxPath, pdfPath);

    // Sprawdź że rename zostało wywołane z poprawnymi (platformowo) ścieżkami
    expect(mockFns.rename).toHaveBeenCalledWith(expectedPdf, pdfPath);
  });

  it('powinien nie wywoływać rename gdy docelowa nazwa pokrywa się z wygenerowaną', async () => {
    // docxPath = /out/invoice.docx → LibreOffice generuje /out/invoice.pdf = pdfPath
    await convertDocxToPdf('/out/invoice.docx', '/out/invoice.pdf');

    expect(mockFns.rename).not.toHaveBeenCalled();
  });

  it('powinien rzucić błąd gdy libreOfficePath nie jest skonfigurowane', async () => {
    mockFns.getConfig.mockReturnValue({ libreOfficePath: null });

    await expect(convertDocxToPdf('/tmp/invoice.docx', '/tmp/invoice.pdf')).rejects.toThrow(
      'Ścieżka do LibreOffice nie jest skonfigurowana (LIBREOFFICE_PATH).',
    );
  });

  it('powinien rzucić błąd gdy plik wejściowy DOCX nie istnieje', async () => {
    mockFns.access.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await expect(convertDocxToPdf('/tmp/missing.docx', '/tmp/missing.pdf')).rejects.toThrow(
      'Nie znaleziono pliku wejściowego: /tmp/missing.docx',
    );
  });

  it('powinien rzucić błąd gdy plik PDF nie powstał po konwersji (brak rename)', async () => {
    // invoice.docx → invoice.pdf (bez rename), ale access na pdfPath rzuca błąd
    mockFns.access
      .mockResolvedValueOnce(undefined) // access(docxPath) — plik istnieje
      .mockRejectedValueOnce(new Error('ENOENT')); // access(pdfPath) — brak pliku wyjściowego

    await expect(convertDocxToPdf('/out/invoice.docx', '/out/invoice.pdf')).rejects.toThrow(
      'LibreOffice zakończył działanie, ale brakuje pliku wyjściowego: /out/invoice.pdf',
    );
  });

  it('powinien rzucić błąd gdy plik PDF nie powstał po konwersji (z rename)', async () => {
    // orig.docx → orig.pdf (w katalogu /out/), rename do renamed.pdf
    // Ale brakuje /out/orig.pdf po konwersji
    const docxPath = '/tmp/orig.docx';
    const pdfPath = '/out/renamed.pdf';
    const expectedPdf = join(dirname(pdfPath), `${parse(docxPath).name}.pdf`);

    mockFns.access
      .mockResolvedValueOnce(undefined) // access(docxPath) — istnieje
      .mockRejectedValueOnce(new Error('ENOENT')); // access(expectedPdfPath) — brak

    await expect(convertDocxToPdf(docxPath, pdfPath)).rejects.toThrow(
      `LibreOffice zakończył działanie, ale brakuje pliku wyjściowego: ${expectedPdf}`,
    );
  });
});

// --------------------------------------------------------------------------
// convertMultipleDocxToPdf
// --------------------------------------------------------------------------

describe('convertMultipleDocxToPdf', () => {
  it('powinien zwrócić success=2 gdy wszystkie konwersje się powiodły', async () => {
    const conversions = [
      { docxPath: '/tmp/inv1.docx', pdfPath: '/tmp/inv1.pdf' },
      { docxPath: '/tmp/inv2.docx', pdfPath: '/tmp/inv2.pdf' },
    ];

    const result = await convertMultipleDocxToPdf(conversions);

    expect(result.success).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('powinien zebrać błędy i kontynuować gdy jedna konwersja się nie powiedzie', async () => {
    mockFns.getConfig
      .mockReturnValueOnce(MOCK_CONFIG) // inv1 — sukces
      .mockReturnValueOnce({ libreOfficePath: null }); // inv2 — brak LibreOffice

    const conversions = [
      { docxPath: '/tmp/inv1.docx', pdfPath: '/tmp/inv1.pdf' },
      { docxPath: '/tmp/inv2.docx', pdfPath: '/tmp/inv2.pdf' },
    ];

    const result = await convertMultipleDocxToPdf(conversions);

    expect(result.success).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].file).toBe('/tmp/inv2.docx');
    expect(result.errors[0].error).toContain('Ścieżka do LibreOffice nie jest skonfigurowana');
  });

  it('powinien przetworzyć pliki partiami zgodnie z maxConcurrent', async () => {
    const conversions = [
      { docxPath: '/tmp/a.docx', pdfPath: '/tmp/a.pdf' },
      { docxPath: '/tmp/b.docx', pdfPath: '/tmp/b.pdf' },
      { docxPath: '/tmp/c.docx', pdfPath: '/tmp/c.pdf' },
    ];

    const result = await convertMultipleDocxToPdf(conversions, 2);

    expect(result.success).toBe(3);
    expect(result.failed).toBe(0);
  });
});
