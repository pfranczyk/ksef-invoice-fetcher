/**
 * Zapis definicji pdfmake do pliku PDF.
 * Server-side PdfPrinter + wbudowane czcionki Roboto z VFS pdfmake.
 * Bez child_process, bez plików tymczasowych, bez UMD build.
 */

import { createWriteStream } from 'node:fs';
import PdfPrinter from 'pdfmake';
import vfs from 'pdfmake/build/vfs_fonts.js';
import type { TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces';

/**
 * Czcionki Roboto z VFS pdfmake (base64 → Buffer). pdfmake 0.2.x nie zawiera
 * Roboto-Bold w VFS — bold/bolditalics mapowane na Medium (jak domyślnie w pdfmake).
 */
const ROBOTO_FONTS: TFontDictionary = {
  Roboto: {
    normal: Buffer.from(vfs['Roboto-Regular.ttf'], 'base64'),
    bold: Buffer.from(vfs['Roboto-Medium.ttf'], 'base64'),
    italics: Buffer.from(vfs['Roboto-Italic.ttf'], 'base64'),
    bolditalics: Buffer.from(vfs['Roboto-MediumItalic.ttf'], 'base64'),
  },
};

/**
 * Renderuje definicję dokumentu pdfmake i zapisuje do pliku PDF.
 * @param {TDocumentDefinitions} docDefinition - Definicja dokumentu (pdf-template.ts)
 * @param {string} outputPath - Docelowa ścieżka pliku PDF
 * @returns {Promise<void>} Rozwiązany po zapisaniu pliku
 * @throws {Error} Gdy renderowanie pdfmake lub zapis pliku się nie powiedzie
 */
export function writePdfToFile(docDefinition: TDocumentDefinitions, outputPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      const printer = new PdfPrinter(ROBOTO_FONTS);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const stream = createWriteStream(outputPath);

      pdfDoc.on('error', reject);
      stream.on('error', reject);
      stream.on('finish', resolve);

      pdfDoc.pipe(stream);
      pdfDoc.end();
    } catch (error: unknown) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
