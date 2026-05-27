import { EventEmitter } from 'node:events';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockFns = vi.hoisted(() => ({
  createWriteStream: vi.fn(),
  createPdfKitDocument: vi.fn(),
  PdfPrinterCtor: vi.fn(),
}));

vi.mock('node:fs', () => ({
  createWriteStream: mockFns.createWriteStream,
}));

vi.mock('pdfmake', () => ({
  default: function PdfPrinter(this: unknown, fonts: unknown) {
    mockFns.PdfPrinterCtor(fonts);
    return { createPdfKitDocument: mockFns.createPdfKitDocument };
  },
}));

vi.mock('pdfmake/build/vfs_fonts.js', () => ({
  default: {
    'Roboto-Regular.ttf': 'AA==',
    'Roboto-Medium.ttf': 'AA==',
    'Roboto-Italic.ttf': 'AA==',
    'Roboto-MediumItalic.ttf': 'AA==',
  },
}));

// Import po zarejestrowaniu mocków
const { writePdfToFile } = await import('../pdf-writer.ts');

// --------------------------------------------------------------------------
// Pomocnicze fake'i strumieni
// --------------------------------------------------------------------------

const DOC_DEF: TDocumentDefinitions = { content: ['x'] };

/**
 * Tworzy fałszywy dokument PDFKit + strumień zapisu sterowane zdarzeniami.
 */
function makeFakes(): { pdfDoc: EventEmitter & { pipe: unknown; end: unknown }; stream: EventEmitter } {
  const stream = new EventEmitter();
  const pdfDoc = Object.assign(new EventEmitter(), {
    pipe: vi.fn(),
    end: vi.fn(),
  });
  return { pdfDoc, stream };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------
// writePdfToFile
// --------------------------------------------------------------------------

describe('writePdfToFile', () => {
  it('powinien zbudować PdfPrinter z czcionkami Roboto (bufory) i zapisać plik', async () => {
    const { pdfDoc, stream } = makeFakes();
    mockFns.createPdfKitDocument.mockReturnValue(pdfDoc);
    mockFns.createWriteStream.mockReturnValue(stream);

    const promise = writePdfToFile(DOC_DEF, '/out/faktura.pdf');
    // symulacja zakończenia zapisu
    stream.emit('finish');
    await expect(promise).resolves.toBeUndefined();

    expect(mockFns.createWriteStream).toHaveBeenCalledWith('/out/faktura.pdf');
    expect(mockFns.createPdfKitDocument).toHaveBeenCalledWith(DOC_DEF);
    const fonts = mockFns.PdfPrinterCtor.mock.calls[0][0] as {
      Roboto: { normal: Buffer; bold: Buffer; italics: Buffer; bolditalics: Buffer };
    };
    expect(Buffer.isBuffer(fonts.Roboto.normal)).toBe(true);
    expect(Buffer.isBuffer(fonts.Roboto.bold)).toBe(true);
    expect(pdfDoc.pipe).toHaveBeenCalledWith(stream);
    expect(pdfDoc.end).toHaveBeenCalledOnce();
  });

  it('powinien odrzucić obietnicę gdy strumień zapisu zgłosi błąd', async () => {
    const { pdfDoc, stream } = makeFakes();
    mockFns.createPdfKitDocument.mockReturnValue(pdfDoc);
    mockFns.createWriteStream.mockReturnValue(stream);

    const promise = writePdfToFile(DOC_DEF, '/out/faktura.pdf');
    stream.emit('error', new Error('dysk pełny'));

    await expect(promise).rejects.toThrow('dysk pełny');
  });

  it('powinien odrzucić obietnicę gdy renderowanie pdfmake rzuci błąd', async () => {
    mockFns.createPdfKitDocument.mockImplementation(() => {
      throw new Error('błąd pdfmake');
    });
    mockFns.createWriteStream.mockReturnValue(new EventEmitter());

    await expect(writePdfToFile(DOC_DEF, '/out/faktura.pdf')).rejects.toThrow('błąd pdfmake');
  });
});
