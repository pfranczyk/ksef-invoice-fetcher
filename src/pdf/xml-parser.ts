/**
 * Moduł parsowania XML faktur KSeF na strukturę danych
 * Odpowiedzialny za konwersję XML→JSON i mapowanie pól
 * @ref ksef-docs/faktury/schemy/FA/schemat_FA(2)_v1-0E.xsd
 */

import { promises as fs } from 'node:fs';
import { parseString } from 'xml2js';
import logger from '../utils/logger.ts';

/**
 * Pozycja faktury w szablonie
 */
interface IInvoiceItem {
  lp: string;
  nazwa: string;
  ilosc: string;
  jednostka: string;
  cenaNetto: string;
  wartoscNetto: string;
  stawkaVAT: string;
  kwotaVAT: string;
}

/**
 * Dane faktury do wypełnienia szablonu DOCX
 */
interface IInvoiceData {
  numerFaktury: string;
  numerKSeF: string;
  dataWystawienia: string;
  dataSprzedazy: string;
  sprzedawcaNazwa: string;
  sprzedawcaNIP: string;
  sprzedawcaAdres: string;
  nabywcaNazwa: string;
  nabywcaNIP: string;
  nabywcaAdres: string;
  waluta: string;
  wartoscNetto: string;
  kwotaVAT: string;
  wartoscBrutto: string;
  pozycje: IInvoiceItem[];
}

/**
 * Obiekt adresu z XML faktury
 */
interface IAddress {
  AdresL1?: string;
  AdresL2?: string;
  KodKraju?: string;
}

/**
 * Parsuje plik XML faktury na obiekt JSON
 * @param {string} xmlFilePath - Ścieżka do pliku XML
 * @returns {Promise<Object>} - Sparsowany obiekt faktury
 */
export async function parseInvoiceXml(xmlFilePath: string): Promise<unknown> {
  try {
    logger.debug(`Parsowanie pliku XML: ${xmlFilePath}`);

    const xmlContent = await fs.readFile(xmlFilePath, 'utf-8');

    return new Promise((resolve, reject) => {
      parseString(
        xmlContent,
        {
          explicitArray: false,
          mergeAttrs: true,
          trim: true,
        },
        (err: Error | null, result: unknown) => {
          if (err) {
            reject(new Error(`Nie udało się sparsować XML: ${err.message}`));
          } else {
            resolve(result);
          }
        },
      );
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Błąd parsowania pliku XML ${xmlFilePath}: ${errorMessage}`);
    if (error instanceof Error && error.stack) {
      logger.debug(`Stack trace: ${error.stack}`);
    }
    throw error;
  }
}

/**
 * Mapuje sparsowany XML na płaską strukturę danych dla szablonu
 * @param {Object} parsedXml - Sparsowany obiekt XML
 * @param {string} fileName - Nazwa pliku (do ekstrakcji numeru KSeF)
 * @returns {Object} - Płaska struktura danych gotowa dla szablonu
 */
export function mapInvoiceData(parsedXml: unknown, fileName: string): IInvoiceData {
  try {
    logger.debug('Mapowanie danych faktury ze struktury XML');

    // Type guard dla parsedXml
    const parsed = parsedXml as Record<string, unknown>;
    const faktura = (parsed.Faktura || {}) as Record<string, unknown>;
    const naglowek = (faktura.Naglowek || {}) as Record<string, unknown>;
    const podmiot1 = (faktura.Podmiot1 || {}) as Record<string, unknown>; // Sprzedawca
    const podmiot2 = (faktura.Podmiot2 || {}) as Record<string, unknown>; // Nabywca
    const fa = (faktura.Fa || {}) as Record<string, unknown>;

    // Ekstrakcja numeru KSeF z nazwy pliku (format: {ksefNumber}.xml)
    const ksefNumber = fileName.replace('.xml', '');

    // Mapowanie podstawowych danych
    const mappedData: IInvoiceData = {
      // Nagłówek faktury
      numerFaktury: String(fa.P_2 || ''),
      numerKSeF: ksefNumber,
      dataWystawienia: formatDate(naglowek.DataWytworzeniaFa as string | undefined),
      dataSprzedazy: formatDate(fa.P_1 as string | undefined),

      // Sprzedawca (Podmiot1)
      sprzedawcaNazwa: getNestedValue(podmiot1, 'DaneIdentyfikacyjne.Nazwa', ''),
      sprzedawcaNIP: getNestedValue(podmiot1, 'DaneIdentyfikacyjne.NIP', ''),
      sprzedawcaAdres: formatAddress(podmiot1.Adres as IAddress | undefined),

      // Nabywca (Podmiot2)
      nabywcaNazwa: getNestedValue(podmiot2, 'DaneIdentyfikacyjne.Nazwa', ''),
      nabywcaNIP: getNestedValue(podmiot2, 'DaneIdentyfikacyjne.NIP', ''),
      nabywcaAdres: formatAddress(podmiot2.Adres as IAddress | undefined),

      // Waluta i podsumowanie
      waluta: String(fa.KodWaluty || 'PLN'),
      wartoscNetto: formatAmount(fa.P_13_1 as string | number | undefined),
      kwotaVAT: formatAmount(fa.P_14_1 as string | number | undefined),
      wartoscBrutto: formatAmount(fa.P_15 as string | number | undefined),

      // Pozycje faktury
      pozycje: extractInvoiceItems(fa.FaWiersz),
    };

    logger.debug(`Zmapowano dane faktury: ${mappedData.numerFaktury}`);
    return mappedData;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Błąd mapowania danych faktury: ${errorMessage}`);
    if (error instanceof Error && error.stack) {
      logger.debug(`Stack trace: ${error.stack}`);
    }
    throw error;
  }
}

/**
 * Ekstrahuje pozycje faktury z sekcji FaWiersz
 * @param {Object|Array} faWiersz - Pozycje faktury (może być obiektem lub tablicą)
 * @returns {Array} - Tablica pozycji faktury
 */
function extractInvoiceItems(faWiersz: unknown): IInvoiceItem[] {
  if (!faWiersz) {
    return [];
  }

  // XML może zwrócić pojedynczy obiekt lub tablicę
  const items = Array.isArray(faWiersz) ? faWiersz : [faWiersz];

  return items.map((item, index) => {
    // P_11 = wartość netto (podstawowe pole)
    // P_11A = wartość brutto (opcjonalne, gdy stosuje się art. 106e ust. 7 i 8)
    // Priorytet: P_11 (netto) jako wartość podstawowa
    let wartoscNetto = 0;
    let wartoscBrutto = 0;

    if (item.P_11) {
      // Standardowy przypadek - mamy wartość netto
      wartoscNetto = parseFloat(item.P_11);
      if (item.P_11A) {
        // Jeśli jest też brutto, użyj go
        wartoscBrutto = parseFloat(item.P_11A);
      }
    } else if (item.P_11A) {
      // Rzadki przypadek - tylko wartość brutto
      // Musimy wyliczyć netto odejmując VAT
      wartoscBrutto = parseFloat(item.P_11A);
      const stawkaVAT = parseFloat(item.P_12 || 0);
      wartoscNetto = wartoscBrutto / (1 + stawkaVAT / 100);
    }

    const stawkaVAT = parseFloat(item.P_12 || 0);

    // Oblicz kwotę VAT
    let kwotaVAT: number;
    if (item.P_11Vat) {
      // Jeśli kwota VAT jest jawnie podana, użyj jej
      kwotaVAT = parseFloat(item.P_11Vat);
    } else if (wartoscBrutto > 0 && wartoscNetto > 0) {
      // Oblicz z różnicy brutto - netto
      kwotaVAT = wartoscBrutto - wartoscNetto;
    } else {
      // Oblicz ze stawki i wartości netto
      kwotaVAT = (wartoscNetto * stawkaVAT) / 100;
    }

    // P_9A = cena jednostkowa netto (podstawowe)
    // P_9B = cena jednostkowa brutto (opcjonalne)
    // Priorytet: P_9A (netto)
    let cenaNetto = 0;
    if (item.P_9A) {
      cenaNetto = parseFloat(item.P_9A);
    } else if (item.P_9B) {
      // Jeśli tylko brutto, oblicz netto
      const cenaBrutto = parseFloat(item.P_9B);
      cenaNetto = cenaBrutto / (1 + stawkaVAT / 100);
    }

    return {
      lp: item.NrWierszaFa || (index + 1).toString(),
      nazwa: item.P_7 || '',
      ilosc: formatAmount(item.P_8B, 0),
      jednostka: item.P_8A || 'szt',
      cenaNetto: formatAmount(cenaNetto),
      wartoscNetto: formatAmount(wartoscNetto),
      stawkaVAT: `${formatAmount(stawkaVAT, 0)}%`,
      kwotaVAT: formatAmount(kwotaVAT),
    };
  });
}

/**
 * Formatuje datę z formatu ISO na DD.MM.YYYY
 * @param {string} dateString - Data w formacie ISO
 * @returns {string} - Sformatowana data
 */
function formatDate(dateString: string | undefined): string {
  if (!dateString) {
    return '';
  }

  try {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}.${month}.${year}`;
  } catch (_error) {
    logger.warn(`Nie udało się sformatować daty: ${dateString}`);
    return dateString;
  }
}

/**
 * Formatuje kwotę z separatorami tysięcy i miejscami po przecinku
 * @param {string|number} amount - Kwota do sformatowania
 * @param {number} decimals - Liczba miejsc po przecinku (domyślnie 2)
 * @returns {string} - Sformatowana kwota
 */
function formatAmount(amount: string | number | undefined | null, decimals: number = 2): string {
  if (amount === undefined || amount === null || amount === '') {
    return '0.00';
  }

  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (Number.isNaN(numAmount)) {
    return '0.00';
  }

  return numAmount.toLocaleString('pl-PL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Formatuje adres z dostępnych pól
 * @param {Object} adres - Obiekt adresu
 * @returns {string} - Sformatowany adres
 */
function formatAddress(adres: IAddress | undefined): string {
  if (!adres) {
    return '';
  }

  const parts = [];

  if (adres.AdresL1) {
    parts.push(adres.AdresL1);
  }

  if (adres.AdresL2) {
    parts.push(adres.AdresL2);
  }

  if (adres.KodKraju) {
    parts.push(adres.KodKraju);
  }

  return parts.join(', ');
}

/**
 * Pobiera wartość z zagnieżdżonego obiektu używając notacji kropkowej
 * @param {Object} obj - Obiekt źródłowy
 * @param {string} path - Ścieżka do wartości (np. 'DaneIdentyfikacyjne.Nazwa')
 * @param {*} defaultValue - Wartość domyślna
 * @returns {*} - Pobrana wartość lub wartość domyślna
 */
function getNestedValue(obj: unknown, path: string, defaultValue: string = ''): string {
  if (!obj || typeof obj !== 'object') {
    return defaultValue;
  }

  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (!current || typeof current !== 'object') {
      return defaultValue;
    }

    const objCurrent = current as Record<string, unknown>;
    if (objCurrent[key] === undefined || objCurrent[key] === null) {
      return defaultValue;
    }
    current = objCurrent[key];
  }

  return typeof current === 'string' ? current : String(current);
}
