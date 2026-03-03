/**
 * Moduł konwersji DOCX na PDF
 *
 * WYMAGANIA:
 * - LibreOffice 7.x+ zainstalowany na systemie
 * - Zmienna środowiskowa LIBREOFFICE_PATH wskazująca na soffice(.exe)
 * - Tryb headless obsługiwany automatycznie (--headless)
 */
import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { promisify } from 'node:util';
import { getConfig } from '../config/env.ts';
import logger from '../utils/logger.ts';

const execPromise = promisify(exec);

/**
 * Pojedyncza konwersja DOCX na PDF
 */
interface IConversion {
  docxPath: string;
  pdfPath: string;
}

/**
 * Błąd konwersji
 */
interface IConversionError {
  file: string;
  error: string;
}

/**
 * Wynik konwersji wsadowej
 */
interface IConversionResult {
  success: number;
  failed: number;
  errors: IConversionError[];
}

/**
 * Konwertuje plik DOCX na PDF przy użyciu LibreOffice (CLI)
 * @param {string} docxPath - Ścieżka do pliku DOCX
 * @param {string} pdfPath - Ścieżka do zapisu PDF
 * @returns {Promise<void>}
 */
export async function convertDocxToPdf(docxPath: string, pdfPath: string): Promise<void> {
  try {
    logger.debug(`Konwertowanie DOCX na PDF: ${docxPath}`);

    const config = getConfig();
    const librePath = config.libreOfficePath;

    if (!librePath) {
      throw new Error('Ścieżka do LibreOffice nie jest skonfigurowana (LIBREOFFICE_PATH).');
    }

    // Sprawdź czy plik wejściowy istnieje
    try {
      await fs.access(docxPath);
    } catch (_e) {
      throw new Error(`Nie znaleziono pliku wejściowego: ${docxPath}`);
    }

    // Katalog wyjściowy
    const outputDir = dirname(pdfPath);

    // LibreOffice generuje plik o tej samej nazwie co wejściowy, ale z rozszerzeniem .pdf
    // w katalogu outputDir
    const inputFileName = basename(docxPath);
    const inputFileNameWithoutExt = parse(inputFileName).name;
    const expectedPdfName = `${inputFileNameWithoutExt}.pdf`;
    const expectedPdfPath = join(outputDir, expectedPdfName);

    // Budowanie komendy
    // Używamy cudzysłowów dla ścieżek, aby obsłużyć spacje
    const command = `"${librePath}" --headless --convert-to pdf --outdir "${outputDir}" "${docxPath}"`;

    logger.debug(`Wykonywanie komendy: ${command}`);

    const { stdout, stderr } = await execPromise(command);

    if (stdout) logger.debug(`Wyjście LibreOffice: ${stdout}`);
    if (stderr) logger.debug(`Błędy LibreOffice: ${stderr}`);

    // Jeśli docelowa nazwa pliku jest inna niż ta wygenerowana przez LO, zmień nazwę
    if (resolve(expectedPdfPath) !== resolve(pdfPath)) {
      logger.debug(`Zmiana nazwy ${expectedPdfPath} na ${pdfPath}`);
      // Sprawdź czy plik wyjściowy powstał
      try {
        await fs.access(expectedPdfPath);
      } catch (_e) {
        throw new Error(`LibreOffice zakończył działanie, ale brakuje pliku wyjściowego: ${expectedPdfPath}`);
      }

      await fs.rename(expectedPdfPath, pdfPath);
    } else {
      // Sprawdź czy plik powstał (przypadek gdy nazwy się pokrywają)
      try {
        await fs.access(pdfPath);
      } catch (_e) {
        throw new Error(`LibreOffice zakończył działanie, ale brakuje pliku wyjściowego: ${pdfPath}`);
      }
    }

    logger.info(`✓ PDF wygenerowany pomyślnie: ${pdfPath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('not found')) {
      logger.error('Nie znaleziono pliku wykonywalnego LibreOffice lub ścieżka jest nieprawidłowa.');
    }
    logger.error(`Błąd konwersji DOCX na PDF: ${errorMessage}`);
    throw error;
  }
}

/**
 * Konwertuje wiele plików DOCX na PDF
 * @param {Array<{docxPath: string, pdfPath: string}>} conversions - Lista konwersji
 * @param {number} maxConcurrent - Maksymalna liczba równoczesnych konwersji
 * @returns {Promise<{success: number, failed: number, errors: Array}>}
 */
export async function convertMultipleDocxToPdf(
  conversions: IConversion[],
  maxConcurrent: number = 1,
): Promise<IConversionResult> {
  const results: IConversionResult = {
    success: 0,
    failed: 0,
    errors: [] as IConversionError[],
  };

  logger.info(`Rozpoczynanie konwersji wsadowej: ${conversions.length} plików`);

  // Podziel na partie
  for (let i = 0; i < conversions.length; i += maxConcurrent) {
    const batch = conversions.slice(i, i + maxConcurrent);

    const promises = batch.map(async ({ docxPath, pdfPath }): Promise<void> => {
      try {
        await convertDocxToPdf(docxPath, pdfPath);
        results.success++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.failed++;
        const conversionError: IConversionError = {
          file: docxPath,
          error: errorMessage,
        };
        results.errors.push(conversionError);
      }
    });

    await Promise.all(promises);

    const progress = Math.min(i + maxConcurrent, conversions.length);
    logger.info(`Postęp: przetworzono ${progress}/${conversions.length} plików`);
  }

  logger.info(`Konwersja wsadowa zakończona: ${results.success} udanych, ${results.failed} nieudanych`);
  return results;
}
