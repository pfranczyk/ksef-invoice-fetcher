/**
 * Moduł przetwarzania szablonów DOCX
 * Odpowiedzialny za wypełnianie szablonów danymi faktury
 */

import { promises as fs } from 'node:fs';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import logger from '../utils/logger.ts';

/**
 * Przetwarza szablon DOCX i wypełnia go danymi faktury
 * @param {string} templatePath - Ścieżka do szablonu DOCX
 * @param {Object} invoiceData - Dane faktury do wypełnienia
 * @param {string} outputPath - Ścieżka do zapisu wypełnionego dokumentu
 * @returns {Promise<void>}
 */
export async function processTemplate(templatePath: string, invoiceData: object, outputPath: string): Promise<void> {
  try {
    logger.debug(`Przetwarzanie szablonu: ${templatePath}`);

    // Wczytaj szablon DOCX
    const content = await fs.readFile(templatePath, 'binary');

    // Utwórz ZIP z zawartości
    const zip = new PizZip(content);

    // Zamień tabelę z pozycjami faktury z pływającej (floating) na inline,
    // aby mogła się łamać na kolejne strony. Dotyczy TYLKO tabeli z pętlą {#pozycje}.
    convertItemsTableToInline(zip);

    // Utwórz instancję docxtemplater
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '', // Puste stringi dla brakujących wartości
    });

    // Renderuj dokument z danymi (nowa metoda API)
    try {
      doc.render(invoiceData);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Błąd renderowania szablonu: ${errorMessage}`);

      // Jeśli błąd dotyczy brakujących tagów, pokaż szczegóły
      if (error && typeof error === 'object' && 'properties' in error) {
        const docError = error as { properties?: { errors?: Array<{ message: string }> } };
        if (docError.properties?.errors) {
          docError.properties.errors.forEach((err) => {
            logger.error(`Błąd szablonu: ${err.message}`);
          });
        }
      }

      throw new Error(`Nie udało się wyrenderować szablonu: ${errorMessage}`);
    }

    // Generuj wypełniony dokument
    const buf = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    // Zapisz do pliku
    await fs.writeFile(outputPath, buf);

    logger.debug(`Szablon przetworzony poprawnie: ${outputPath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Błąd przetwarzania szablonu: ${errorMessage}`);
    throw error;
  }
}

/**
 * Sprawdza czy szablon DOCX istnieje i jest poprawny
 * @param {string} templatePath - Ścieżka do szablonu
 * @returns {Promise<boolean>}
 */
export async function validateTemplate(templatePath: string): Promise<boolean> {
  try {
    // Sprawdź istnienie pliku
    await fs.access(templatePath);

    // Sprawdź czy to plik DOCX (ZIP)
    const content = await fs.readFile(templatePath, 'binary');

    try {
      const zip = new PizZip(content);
      // Sprawdź czy zawiera podstawowe pliki DOCX
      if (!zip.files['word/document.xml']) {
        logger.error('Nieprawidłowy szablon DOCX: brak word/document.xml');
        return false;
      }

      logger.debug(`Szablon zweryfikowany poprawnie: ${templatePath}`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Nieprawidłowy szablon DOCX: ${errorMessage}`);
      return false;
    }
  } catch (error) {
    const isNodeError = error && typeof error === 'object' && 'code' in error;
    if (isNodeError && (error as { code: string }).code === 'ENOENT') {
      logger.error(`Nie znaleziono pliku szablonu: ${templatePath}`);
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Błąd walidacji szablonu: ${errorMessage}`);
    }
    return false;
  }
}

/**
 * Konwertuje tabelę z pozycjami faktury z pływającej (floating) na inline.
 *
 * Tabele pływające (z elementem tblpPr) w LibreOffice nie mogą się łamać na kolejne strony,
 * co powoduje obcinanie długich tabel. Modyfikacja dotyczy WYŁĄCZNIE tabeli zawierającej
 * tag {#pozycje} — pozostałe tabele (nagłówek, podsumowanie) zachowują oryginalne
 * pozycjonowanie, żeby nie zaburzać układu szablonu użytkownika.
 *
 * Istniejące wcięcie tabeli (tblInd) pozostaje bez zmian.
 *
 * @param {PizZip} zip - Obiekt ZIP szablonu DOCX
 * @returns {void}
 */
function convertItemsTableToInline(zip: PizZip): void {
  const documentXmlEntry = zip.files['word/document.xml'];
  if (!documentXmlEntry) {
    logger.warn('Brak word/document.xml w szablonie — pomijam konwersję tabeli');
    return;
  }

  const xml = documentXmlEntry.asText();

  // Znajdź tabelę zawierającą tag {#pozycje} i usuń z niej tblpPr (floating positioning)
  const tableRegex = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  let modified = false;

  const modifiedXml = xml.replace(tableRegex, (tableXml: string): string => {
    if (!tableXml.includes('{#pozycje}')) {
      return tableXml;
    }

    if (!tableXml.includes('<w:tblpPr')) {
      return tableXml;
    }

    modified = true;
    logger.debug('Przekonwertowano tabelę pozycji z floating na inline');
    return tableXml.replace(/<w:tblpPr[^/]*\/>/, '');
  });

  if (modified) {
    zip.file('word/document.xml', modifiedXml);
  }
}
