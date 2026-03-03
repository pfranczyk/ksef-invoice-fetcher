import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processTemplate, validateTemplate } from '../template-processor.ts';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockFns = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: vi.fn(),
  PizZip: vi.fn(),
  Docxtemplater: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: {
    readFile: mockFns.readFile,
    writeFile: mockFns.writeFile,
    access: mockFns.access,
  },
}));

vi.mock('pizzip', () => ({
  default: mockFns.PizZip,
}));

vi.mock('docxtemplater', () => ({
  default: mockFns.Docxtemplater,
}));

vi.mock('../../utils/logger.ts', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  maskSensitiveData: vi.fn((s: string) => s),
}));

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Buduje instancję mocka PizZip używaną przez processTemplate i validateTemplate.
 * asText() zwraca prosty XML bez tagów {#pozycje} — pomija konwersję tabeli.
 */
function buildMockZip(hasDocumentXml: boolean = true) {
  return {
    files: hasDocumentXml ? { 'word/document.xml': { asText: vi.fn().mockReturnValue('<w:document/>') } } : {},
    file: vi.fn(),
  };
}

/**
 * Buduje instancję mocka Docxtemplater.
 */
function buildMockDoc(renderImpl?: () => void) {
  const generate = vi.fn().mockReturnValue(Buffer.from('generated-docx-content'));
  const getZip = vi.fn().mockReturnValue({ generate });
  const render = renderImpl ? vi.fn().mockImplementation(renderImpl) : vi.fn();
  return { render, getZip, _generate: generate };
}

/**
 * Konfiguruje PizZip jako konstruktor zwracający podany obiekt.
 * Vitest 4.x wymaga `function` (nie arrow) dla mocków konstruktorów.
 */
function setupPizZipMock(mockZip: ReturnType<typeof buildMockZip>): void {
  mockFns.PizZip.mockImplementation(function () {
    return mockZip;
  });
}

/**
 * Konfiguruje Docxtemplater jako konstruktor zwracający podany obiekt.
 */
function setupDocxtemplaterMock(mockDoc: ReturnType<typeof buildMockDoc>): void {
  mockFns.Docxtemplater.mockImplementation(function () {
    return mockDoc;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------
// validateTemplate
// --------------------------------------------------------------------------

describe('validateTemplate', () => {
  it('powinien zwrócić true gdy plik istnieje i zawiera word/document.xml', async () => {
    mockFns.access.mockResolvedValue(undefined);
    mockFns.readFile.mockResolvedValue('<binary content>');
    setupPizZipMock(buildMockZip(true));

    const result = await validateTemplate('/template/invoice.docx');

    expect(result).toBe(true);
  });

  it('powinien zwrócić false gdy plik szablonu nie istnieje (ENOENT)', async () => {
    mockFns.access.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await validateTemplate('/template/missing.docx');

    expect(result).toBe(false);
    expect(mockFns.readFile).not.toHaveBeenCalled();
  });

  it('powinien zwrócić false gdy ZIP nie zawiera word/document.xml', async () => {
    mockFns.access.mockResolvedValue(undefined);
    mockFns.readFile.mockResolvedValue('<binary content>');
    setupPizZipMock(buildMockZip(false)); // brak word/document.xml

    const result = await validateTemplate('/template/invalid.docx');

    expect(result).toBe(false);
  });

  it('powinien zwrócić false gdy PizZip rzuci błąd (uszkodzony plik)', async () => {
    mockFns.access.mockResolvedValue(undefined);
    mockFns.readFile.mockResolvedValue('<not a zip>');
    mockFns.PizZip.mockImplementation(function () {
      throw new Error('Nie można odczytać ZIP');
    });

    const result = await validateTemplate('/template/corrupt.docx');

    expect(result).toBe(false);
  });
});

// --------------------------------------------------------------------------
// processTemplate
// --------------------------------------------------------------------------

describe('processTemplate', () => {
  it('powinien wczytać szablon, wyrenderować dane i zapisać plik wynikowy', async () => {
    const mockZip = buildMockZip();
    const mockDoc = buildMockDoc();
    mockFns.readFile.mockResolvedValue('<binary docx>');
    mockFns.writeFile.mockResolvedValue(undefined);
    setupPizZipMock(mockZip);
    setupDocxtemplaterMock(mockDoc);

    const invoiceData = { numerFaktury: 'FV/001', pozycje: [] };
    await processTemplate('/template.docx', invoiceData, '/output/invoice.docx');

    expect(mockFns.readFile).toHaveBeenCalledWith('/template.docx', 'binary');
    expect(mockDoc.render).toHaveBeenCalledWith(invoiceData);
    expect(mockFns.writeFile).toHaveBeenCalledWith('/output/invoice.docx', expect.any(Buffer));
  });

  it('powinien przekazać dane faktury do doc.render z dokładnie podanymi polami', async () => {
    const mockZip = buildMockZip();
    const mockDoc = buildMockDoc();
    mockFns.readFile.mockResolvedValue('<binary docx>');
    mockFns.writeFile.mockResolvedValue(undefined);
    setupPizZipMock(mockZip);
    setupDocxtemplaterMock(mockDoc);

    const invoiceData = {
      numerFaktury: 'FV/2026/001',
      numerKSeF: 'KSEF123',
      sprzedawcaNazwa: 'ACME Sp. z o.o.',
      pozycje: [{ lp: '1', nazwa: 'Usługa' }],
    };
    await processTemplate('/template.docx', invoiceData, '/output/invoice.docx');

    expect(mockDoc.render).toHaveBeenCalledWith(invoiceData);
  });

  it('powinien rzucić błąd gdy doc.render rzuci wyjątek', async () => {
    const mockZip = buildMockZip();
    const mockDoc = buildMockDoc(() => {
      throw new Error('Brakujący tag {numerFaktury}');
    });
    mockFns.readFile.mockResolvedValue('<binary docx>');
    setupPizZipMock(mockZip);
    setupDocxtemplaterMock(mockDoc);

    await expect(processTemplate('/template.docx', {}, '/output/invoice.docx')).rejects.toThrow(
      'Nie udało się wyrenderować szablonu: Brakujący tag {numerFaktury}',
    );

    expect(mockFns.writeFile).not.toHaveBeenCalled();
  });

  it('powinien rzucić błąd gdy odczyt szablonu się nie powiódł', async () => {
    mockFns.readFile.mockRejectedValue(new Error('Brak dostępu do pliku'));

    await expect(processTemplate('/template.docx', {}, '/output/invoice.docx')).rejects.toThrow(
      'Brak dostępu do pliku',
    );
  });

  it('powinien usunąć tblpPr z tabeli zawierającej {#pozycje} (konwersja floating→inline)', async () => {
    const xmlWithFloatingTable =
      '<w:document><w:tbl>' +
      '<w:tblPr><w:tblpPr w:vertAnchor="text"/></w:tblPr>' +
      '<w:tr><w:tc>{#pozycje}{/pozycje}</w:tc></w:tr>' +
      '</w:tbl></w:document>';

    const mockAsText = vi.fn().mockReturnValue(xmlWithFloatingTable);
    const mockZipFile = vi.fn();
    const mockZip = {
      files: { 'word/document.xml': { asText: mockAsText } },
      file: mockZipFile,
    };
    const mockDoc = buildMockDoc();
    mockFns.readFile.mockResolvedValue('<binary docx>');
    mockFns.writeFile.mockResolvedValue(undefined);
    setupPizZipMock(mockZip);
    setupDocxtemplaterMock(mockDoc);

    await processTemplate('/template.docx', {}, '/output/invoice.docx');

    // Sprawdź że zip.file() zostało wywołane — XML bez tblpPr został zapisany
    expect(mockZipFile).toHaveBeenCalledOnce();
    const savedXml = mockZipFile.mock.calls[0][1] as string;
    expect(savedXml).not.toContain('<w:tblpPr w:vertAnchor="text"/>');
  });
});
