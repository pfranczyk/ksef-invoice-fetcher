/**
 * Moduł parsowania XML faktur KSeF na strukturę danych.
 * Konwersja XML→JSON (xml2js) i wierne mapowanie pełnego modelu faktury.
 * Kontraktem jest schemat FA(3) (schemat_FA(3)_v1-0E.xsd), nie konkretne próbki faktur.
 */

import { promises as fs } from 'node:fs';
import { parseString } from 'xml2js';
import logger from '../utils/logger.ts';

/**
 * Mapa etykiet słownikowych (kod XML → opis czytelny dla człowieka).
 */
type TLabelMap = Readonly<Record<string, string>>;

/**
 * Formy płatności wg TFormaPlatnosci (FA(3) XSD).
 */
const FORMA_PLATNOSCI = Object.freeze<TLabelMap>({
  '1': 'Gotówka',
  '2': 'Karta',
  '3': 'Bon',
  '4': 'Czek',
  '5': 'Kredyt',
  '6': 'Przelew',
  '7': 'Płatność mobilna',
});

/**
 * Rodzaje faktury wg TRodzajFaktury (FA(3) XSD).
 */
const RODZAJ_FAKTURY = Object.freeze<TLabelMap>({
  VAT: 'Faktura podstawowa',
  KOR: 'Faktura korygująca',
  ZAL: 'Faktura zaliczkowa',
  ROZ: 'Faktura rozliczeniowa',
  UPR: 'Faktura uproszczona',
  KOR_ZAL: 'Korekta faktury zaliczkowej',
  KOR_ROZ: 'Korekta faktury rozliczeniowej',
});

/**
 * Role podmiotu trzeciego wg TRolaPodmiotu3 (FA(3) XSD).
 */
const ROLA_PODMIOTU3 = Object.freeze<TLabelMap>({
  '1': 'Faktor',
  '2': 'Odbiorca',
  '3': 'Podmiot pierwotny',
  '4': 'Dodatkowy nabywca',
  '5': 'Wystawca faktury',
  '6': 'Podmiot reprezentujący',
  '7': 'Dokonujący płatności',
  '9': 'Jednostka samorządu terytorialnego — wystawca',
  '10': 'Członek grupy VAT',
});

/**
 * Definicja wiersza rekapitulacji VAT (pola autorytatywne z sekcji Fa).
 */
type TRecapDef = {
  readonly netto: string;
  readonly vat?: string;
  readonly stawka: string;
};

/**
 * Mapa pól P_13_x/P_14_x na etykiety stawek (FA(3) XSD).
 */
const RECAP_DEFS = Object.freeze<readonly TRecapDef[]>([
  { netto: 'P_13_1', vat: 'P_14_1', stawka: '23% (22%)' },
  { netto: 'P_13_2', vat: 'P_14_2', stawka: '8% (7%)' },
  { netto: 'P_13_3', vat: 'P_14_3', stawka: '5%' },
  { netto: 'P_13_4', vat: 'P_14_4', stawka: '4% (ryczałt taxi)' },
  { netto: 'P_13_5', vat: 'P_14_5', stawka: 'Procedura szczególna' },
  { netto: 'P_13_6_1', stawka: '0% (krajowa)' },
  { netto: 'P_13_6_2', stawka: '0% (WDT)' },
  { netto: 'P_13_6_3', stawka: '0% (eksport)' },
  { netto: 'P_13_7', stawka: 'zw.' },
  { netto: 'P_13_8', stawka: 'np. (poza terytorium)' },
  { netto: 'P_13_9', stawka: 'np. (art. 100 ust. 1 pkt 4)' },
  { netto: 'P_13_10', stawka: 'odwrotne obciążenie' },
  { netto: 'P_13_11', stawka: 'procedura marży' },
]);

/**
 * Pozycja faktury (FaWiersz). Pola opcjonalne renderowane tylko gdy obecne.
 */
export interface IInvoiceItem {
  lp: string;
  nazwa: string;
  indeks?: string;
  gtin?: string;
  cn?: string;
  gtu?: string;
  dataWykonania?: string;
  jednostka?: string;
  ilosc?: string;
  cenaNetto?: string;
  rabat?: string;
  wartoscNetto: string;
  wartoscBrutto?: string;
  stawkaVAT: string;
  kwotaVAT: string;
  zal15: boolean;
}

/**
 * Strona transakcji (Podmiot1 — sprzedawca / Podmiot2 — nabywca).
 */
export interface IInvoiceParty {
  nazwa: string;
  nip?: string;
  prefiks?: string;
  adres: string;
  adresKoresp?: string;
  email?: string;
  telefon?: string;
  nrKlienta?: string;
}

/**
 * Podmiot trzeci (Podmiot3) — faktor, odbiorca, wystawca itp.
 */
export interface IThirdParty {
  rola: string;
  nazwa: string;
  nip?: string;
  adres?: string;
}

/**
 * Wiersz rekapitulacji VAT (z autorytatywnych pól P_13_x/P_14_x).
 */
export interface IVatRecapRow {
  stawka: string;
  netto: string;
  vat: string;
  brutto: string;
}

/**
 * Pozycja obciążenia/odliczenia w sekcji Rozliczenie.
 */
export interface ISettlementLine {
  kwota: string;
  powod: string;
}

/**
 * Sekcja Rozliczenie (obciążenia, odliczenia, do zapłaty / do rozliczenia).
 */
export interface IInvoiceSettlement {
  obciazenia: ISettlementLine[];
  sumaObciazen?: string;
  odliczenia: ISettlementLine[];
  sumaOdliczen?: string;
  doZaplaty?: string;
  doRozliczenia?: string;
}

/**
 * Rachunek bankowy (RachunekBankowy).
 */
export interface IBankAccount {
  nrRB: string;
  nazwaBanku?: string;
  swift?: string;
  opis?: string;
}

/**
 * Termin płatności (TerminPlatnosci).
 */
export interface IPaymentTerm {
  termin?: string;
  opis?: string;
}

/**
 * Sekcja Platnosc (status, forma, terminy, rachunki).
 */
export interface IInvoicePayment {
  zaplacono: boolean;
  dataZaplaty?: string;
  forma?: string;
  opisPlatnosci?: string;
  terminy: IPaymentTerm[];
  rachunki: IBankAccount[];
}

/**
 * Pole klucz–wartość (DodatkowyOpis / Stopka.DodatkowyOpis).
 */
export interface IKeyValue {
  klucz: string;
  wartosc: string;
}

/**
 * Sekcja Stopka (noty + rejestry sprzedawcy).
 */
export interface IInvoiceFooter {
  informacje: string[];
  dodatkowyOpis: IKeyValue[];
  rejestry?: { krs?: string; regon?: string; bdo?: string };
}

/**
 * Pełny model danych faktury KSeF (FA(3)). Pola opcjonalne (`undefined`)
 * oznaczają brak danych w XML — odpowiadające sekcje PDF są pomijane.
 */
export interface IInvoiceData {
  formularz: {
    kod?: string;
    wariant?: string;
    dataWytworzenia?: string;
    systemInfo?: string;
  };
  numerFaktury: string;
  numerKSeF: string;
  rodzajFaktury?: string;
  dataWystawienia: string;
  miejsceWystawienia?: string;
  dataSprzedazy?: string;
  okres?: { od: string; do: string };
  waluta: string;
  sprzedawca: IInvoiceParty;
  nabywca: IInvoiceParty;
  podmiotyTrzecie: IThirdParty[];
  pozycje: IInvoiceItem[];
  rekapitulacja: IVatRecapRow[];
  podsumowanie: { netto: string; vat: string; brutto: string };
  adnotacje: string[];
  dodatkowyOpis: IKeyValue[];
  rozliczenie?: IInvoiceSettlement;
  platnosc?: IInvoicePayment;
  stopka?: IInvoiceFooter;
}

/**
 * Obiekt adresu z XML faktury.
 */
interface IAddress {
  AdresL1?: string;
  AdresL2?: string;
  KodKraju?: string;
}

/**
 * Parsuje plik XML faktury na obiekt JSON.
 * @param {string} xmlFilePath - Ścieżka do pliku XML
 * @returns {Promise<unknown>} Sparsowany obiekt faktury
 * @throws {Error} Gdy nie udało się odczytać lub sparsować pliku XML
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
 * Mapuje sparsowany XML na pełną strukturę danych faktury (FA(3)).
 * Mapowanie jest defensywne — brakujące/nieznane elementy nie przerywają procesu.
 * @param {unknown} parsedXml - Sparsowany obiekt XML
 * @param {string} fileName - Nazwa pliku (źródło numeru KSeF)
 * @returns {IInvoiceData} Płaska/zagnieżdżona struktura danych dla szablonu
 * @throws {Error} Gdy struktura XML jest na tyle uszkodzona, że mapowanie zawodzi
 */
export function mapInvoiceData(parsedXml: unknown, fileName: string): IInvoiceData {
  try {
    logger.debug('Mapowanie danych faktury ze struktury XML');

    const parsed = parsedXml as Record<string, unknown>;
    const faktura = obj(parsed.Faktura);
    const naglowek = obj(faktura.Naglowek);
    const podmiot1 = obj(faktura.Podmiot1);
    const podmiot2 = obj(faktura.Podmiot2);
    const fa = obj(faktura.Fa);

    const okresFa = obj(fa.OkresFa);
    const okresOd = xmlText(okresFa.P_6_Od);
    const okresDo = xmlText(okresFa.P_6_Do);

    const data: IInvoiceData = {
      formularz: {
        kod: xmlText(obj(naglowek.KodFormularza).kodSystemowy) ?? xmlText(naglowek.KodFormularza),
        wariant: xmlText(naglowek.WariantFormularza),
        dataWytworzenia: optDate(xmlText(naglowek.DataWytworzeniaFa)),
        systemInfo: xmlText(naglowek.SystemInfo),
      },
      numerFaktury: xmlText(fa.P_2) ?? '',
      numerKSeF: fileName.replace('.xml', ''),
      rodzajFaktury: label(RODZAJ_FAKTURY, xmlText(fa.RodzajFaktury)),
      dataWystawienia: formatDate(xmlText(fa.P_1)),
      miejsceWystawienia: xmlText(fa.P_1M),
      dataSprzedazy: optDate(xmlText(fa.P_6)),
      okres: okresOd && okresDo ? { od: formatDate(okresOd), do: formatDate(okresDo) } : undefined,
      waluta: xmlText(fa.KodWaluty) ?? 'PLN',
      sprzedawca: mapParty(podmiot1),
      nabywca: mapParty(podmiot2),
      podmiotyTrzecie: mapThirdParties(faktura.Podmiot3),
      pozycje: extractInvoiceItems(fa.FaWiersz),
      rekapitulacja: computeVatRecap(fa),
      podsumowanie: computeTotals(fa),
      adnotacje: extractAdnotacje(obj(fa.Adnotacje)),
      dodatkowyOpis: mapKeyValues(fa.DodatkowyOpis),
      rozliczenie: mapSettlement(fa.Rozliczenie),
      platnosc: mapPayment(fa.Platnosc),
      stopka: mapFooter(faktura.Stopka),
    };

    logger.debug(`Zmapowano dane faktury: ${data.numerFaktury}`);
    return data;
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
 * Ekstrahuje pozycje faktury z sekcji FaWiersz.
 * @param {unknown} faWiersz - Pozycje (obiekt pojedynczy lub tablica)
 * @returns {IInvoiceItem[]} Tablica pozycji faktury
 */
function extractInvoiceItems(faWiersz: unknown): IInvoiceItem[] {
  return toArray(faWiersz).map((raw, index) => {
    const item = obj(raw);

    let wartoscNetto = 0;
    let wartoscBrutto = 0;
    const stawkaVAT = parseFloat(xmlText(item.P_12) ?? '0');

    if (xmlText(item.P_11)) {
      wartoscNetto = parseFloat(xmlText(item.P_11) ?? '0');
      if (xmlText(item.P_11A)) {
        wartoscBrutto = parseFloat(xmlText(item.P_11A) ?? '0');
      }
    } else if (xmlText(item.P_11A)) {
      wartoscBrutto = parseFloat(xmlText(item.P_11A) ?? '0');
      wartoscNetto = wartoscBrutto / (1 + stawkaVAT / 100);
    }

    let kwotaVAT: number;
    if (xmlText(item.P_11Vat)) {
      kwotaVAT = parseFloat(xmlText(item.P_11Vat) ?? '0');
    } else if (wartoscBrutto !== 0 && wartoscNetto !== 0) {
      kwotaVAT = wartoscBrutto - wartoscNetto;
    } else {
      kwotaVAT = (wartoscNetto * stawkaVAT) / 100;
    }

    let cenaNetto: number | undefined;
    if (xmlText(item.P_9A)) {
      cenaNetto = parseFloat(xmlText(item.P_9A) ?? '0');
    } else if (xmlText(item.P_9B)) {
      cenaNetto = parseFloat(xmlText(item.P_9B) ?? '0') / (1 + stawkaVAT / 100);
    }

    return {
      lp: xmlText(item.NrWierszaFa) ?? (index + 1).toString(),
      nazwa: xmlText(item.P_7) ?? '',
      indeks: xmlText(item.Indeks),
      gtin: xmlText(item.GTIN),
      cn: xmlText(item.CN),
      gtu: xmlText(item.GTU),
      dataWykonania: optDate(xmlText(item.P_6A)),
      jednostka: xmlText(item.P_8A),
      ilosc: xmlText(item.P_8B) !== undefined ? formatAmount(xmlText(item.P_8B), 0) : undefined,
      cenaNetto: cenaNetto !== undefined ? formatAmount(cenaNetto) : undefined,
      rabat: xmlText(item.P_10) !== undefined ? formatAmount(xmlText(item.P_10)) : undefined,
      wartoscNetto: formatAmount(wartoscNetto),
      wartoscBrutto: xmlText(item.P_11A) !== undefined ? formatAmount(wartoscBrutto) : undefined,
      stawkaVAT: formatStawka(xmlText(item.P_12)),
      kwotaVAT: formatAmount(kwotaVAT),
      zal15: xmlText(item.P_12_Zal_15) === '1',
    };
  });
}

/**
 * Buduje rekapitulację VAT z autorytatywnych pól P_13_x/P_14_x sekcji Fa.
 * @param {Record<string, unknown>} fa - Sekcja Fa
 * @returns {IVatRecapRow[]} Wiersze rekapitulacji (tylko niepuste pola)
 */
function computeVatRecap(fa: Record<string, unknown>): IVatRecapRow[] {
  const rows: IVatRecapRow[] = [];

  for (const def of RECAP_DEFS) {
    const nettoRaw = xmlText(fa[def.netto]);
    if (nettoRaw === undefined) {
      continue;
    }
    const netto = parseFloat(nettoRaw);
    const vat = def.vat ? parseFloat(xmlText(fa[def.vat]) ?? '0') : 0;
    rows.push({
      stawka: def.stawka,
      netto: formatAmount(netto),
      vat: formatAmount(vat),
      brutto: formatAmount(netto + vat),
    });
  }

  return rows;
}

/**
 * Wylicza wiersz RAZEM (autorytatywne sumy z P_13_x/P_14_x/P_15).
 * @param {Record<string, unknown>} fa - Sekcja Fa
 * @returns {{netto:string; vat:string; brutto:string}} Podsumowanie
 */
function computeTotals(fa: Record<string, unknown>): { netto: string; vat: string; brutto: string } {
  let netto = 0;
  let vat = 0;

  for (const def of RECAP_DEFS) {
    const nettoRaw = xmlText(fa[def.netto]);
    if (nettoRaw !== undefined) {
      netto += parseFloat(nettoRaw);
    }
    if (def.vat) {
      const vatRaw = xmlText(fa[def.vat]);
      if (vatRaw !== undefined) {
        vat += parseFloat(vatRaw);
      }
    }
  }

  return {
    netto: formatAmount(netto),
    vat: formatAmount(vat),
    brutto: formatAmount(xmlText(fa.P_15)),
  };
}

/**
 * Mapuje sekcję Podmiot1/Podmiot2 na stronę transakcji.
 * @param {Record<string, unknown>} podmiot - Sekcja podmiotu
 * @returns {IInvoiceParty} Dane strony transakcji
 */
function mapParty(podmiot: Record<string, unknown>): IInvoiceParty {
  const dane = obj(podmiot.DaneIdentyfikacyjne);
  const kontakt = obj(toArray(podmiot.DaneKontaktowe)[0]);

  return {
    nazwa: xmlText(dane.Nazwa) ?? xmlText(dane.PelnaNazwa) ?? '',
    nip: xmlText(dane.NIP),
    prefiks: xmlText(podmiot.PrefiksPodatnika),
    adres: formatAddress(podmiot.Adres as IAddress | undefined),
    adresKoresp: podmiot.AdresKoresp ? formatAddress(podmiot.AdresKoresp as IAddress) : undefined,
    email: xmlText(kontakt.Email),
    telefon: xmlText(kontakt.Telefon),
    nrKlienta: xmlText(podmiot.NrKlienta),
  };
}

/**
 * Mapuje sekcje Podmiot3 na listę podmiotów trzecich.
 * @param {unknown} podmiot3 - Sekcja(e) Podmiot3
 * @returns {IThirdParty[]} Lista podmiotów trzecich
 */
function mapThirdParties(podmiot3: unknown): IThirdParty[] {
  return toArray(podmiot3).map((raw) => {
    const p = obj(raw);
    const dane = obj(p.DaneIdentyfikacyjne);
    return {
      rola: label(ROLA_PODMIOTU3, xmlText(p.Rola)) ?? 'Podmiot trzeci',
      nazwa: xmlText(dane.Nazwa) ?? xmlText(dane.PelnaNazwa) ?? '',
      nip: xmlText(dane.NIP),
      adres: p.Adres ? formatAddress(p.Adres as IAddress) : undefined,
    };
  });
}

/**
 * Ekstrahuje aktywne adnotacje z sekcji Adnotacje.
 * @param {Record<string, unknown>} adn - Sekcja Adnotacje
 * @returns {string[]} Lista etykiet aktywnych adnotacji
 */
function extractAdnotacje(adn: Record<string, unknown>): string[] {
  const out: string[] = [];

  if (xmlText(adn.P_16) === '1') out.push('Metoda kasowa');
  if (xmlText(adn.P_17) === '1') out.push('Samofakturowanie');
  if (xmlText(adn.P_18) === '1') out.push('Odwrotne obciążenie');
  if (xmlText(adn.P_18A) === '1') out.push('Mechanizm podzielonej płatności');
  if (xmlText(adn.P_23) === '1') out.push('Procedura uproszczona (art. 136 ustawy)');

  const zwolnienie = obj(adn.Zwolnienie);
  if (Object.keys(zwolnienie).length > 0 && xmlText(zwolnienie.P_19N) !== '1') {
    out.push('Sprzedaż zwolniona z VAT');
  }

  const marza = obj(adn.PMarzy);
  if (Object.keys(marza).length > 0 && xmlText(marza.P_PMarzyN) !== '1') {
    out.push('Procedura marży');
  }

  return out;
}

/**
 * Mapuje pola klucz–wartość (DodatkowyOpis).
 * @param {unknown} raw - Sekcja(e) DodatkowyOpis
 * @returns {IKeyValue[]} Lista par klucz–wartość
 */
function mapKeyValues(raw: unknown): IKeyValue[] {
  return toArray(raw)
    .map((kv) => {
      const o = obj(kv);
      return { klucz: xmlText(o.Klucz) ?? '', wartosc: xmlText(o.Wartosc) ?? '' };
    })
    .filter((kv) => kv.klucz !== '' || kv.wartosc !== '');
}

/**
 * Mapuje sekcję Rozliczenie.
 * @param {unknown} raw - Sekcja Rozliczenie
 * @returns {IInvoiceSettlement | undefined} Rozliczenie lub undefined gdy brak
 */
function mapSettlement(raw: unknown): IInvoiceSettlement | undefined {
  if (!raw) {
    return undefined;
  }
  const r = obj(raw);

  const mapLines = (v: unknown): ISettlementLine[] =>
    toArray(v).map((line) => {
      const l = obj(line);
      return { kwota: formatAmount(xmlText(l.Kwota)), powod: xmlText(l.Powod) ?? '' };
    });

  return {
    obciazenia: mapLines(r.Obciazenia),
    sumaObciazen: xmlText(r.SumaObciazen) !== undefined ? formatAmount(xmlText(r.SumaObciazen)) : undefined,
    odliczenia: mapLines(r.Odliczenia),
    sumaOdliczen: xmlText(r.SumaOdliczen) !== undefined ? formatAmount(xmlText(r.SumaOdliczen)) : undefined,
    doZaplaty: xmlText(r.DoZaplaty) !== undefined ? formatAmount(xmlText(r.DoZaplaty)) : undefined,
    doRozliczenia: xmlText(r.DoRozliczenia) !== undefined ? formatAmount(xmlText(r.DoRozliczenia)) : undefined,
  };
}

/**
 * Mapuje sekcję Platnosc.
 * @param {unknown} raw - Sekcja Platnosc
 * @returns {IInvoicePayment | undefined} Płatność lub undefined gdy brak
 */
function mapPayment(raw: unknown): IInvoicePayment | undefined {
  if (!raw) {
    return undefined;
  }
  const p = obj(raw);

  const terminy: IPaymentTerm[] = toArray(p.TerminPlatnosci)
    .map((t) => {
      const o = obj(t);
      const opis = obj(o.TerminOpis);
      return {
        termin: optDate(xmlText(o.Termin)),
        opis:
          Object.keys(opis).length > 0
            ? [xmlText(opis.Ilosc), xmlText(opis.Jednostka), xmlText(opis.ZdarzeniePoczatkowe)]
                .filter((s): s is string => Boolean(s))
                .join(' ')
            : undefined,
      };
    })
    .filter((t) => t.termin !== undefined || t.opis !== undefined);

  const rachunki: IBankAccount[] = toArray(p.RachunekBankowy)
    .map((rb) => {
      const o = obj(rb);
      return {
        nrRB: xmlText(o.NrRB) ?? '',
        nazwaBanku: xmlText(o.NazwaBanku),
        swift: xmlText(o.SWIFT),
        opis: xmlText(o.OpisRachunku),
      };
    })
    .filter((rb) => rb.nrRB !== '');

  const formaInna = xmlText(p.PlatnoscInna) === '1' ? xmlText(p.OpisPlatnosci) : undefined;

  return {
    zaplacono: xmlText(p.Zaplacono) === '1',
    dataZaplaty: optDate(xmlText(p.DataZaplaty)),
    forma: formaInna ?? label(FORMA_PLATNOSCI, xmlText(p.FormaPlatnosci)),
    opisPlatnosci: formaInna ? undefined : xmlText(p.OpisPlatnosci),
    terminy,
    rachunki,
  };
}

/**
 * Mapuje sekcję Stopka (noty + rejestry).
 * @param {unknown} raw - Sekcja Stopka
 * @returns {IInvoiceFooter | undefined} Stopka lub undefined gdy brak
 */
function mapFooter(raw: unknown): IInvoiceFooter | undefined {
  if (!raw) {
    return undefined;
  }
  const s = obj(raw);

  const informacje = toArray(s.Informacje)
    .map((i) => xmlText(obj(i).StopkaFaktury))
    .filter((t): t is string => Boolean(t));

  const dodatkowyOpis = mapKeyValues(toArray(s.Informacje).flatMap((i) => toArray(obj(i).DodatkowyOpis)));

  const rej = obj(s.Rejestry);
  const krs = xmlText(rej.KRS);
  const regon = xmlText(rej.REGON);
  const bdo = xmlText(rej.BDO);
  const rejestry = krs || regon || bdo ? { krs, regon, bdo } : undefined;

  if (informacje.length === 0 && dodatkowyOpis.length === 0 && !rejestry) {
    return undefined;
  }

  return { informacje, dodatkowyOpis, rejestry };
}

/**
 * Zwraca wartość jako rekord (pusty, gdy nie jest obiektem).
 * @param {unknown} v - Wartość z xml2js
 * @returns {Record<string, unknown>} Rekord właściwości
 */
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Normalizuje wartość xml2js do tablicy (pojedynczy element → [element]).
 * @param {unknown} v - Wartość (undefined | obiekt | tablica)
 * @returns {unknown[]} Tablica elementów
 */
function toArray(v: unknown): unknown[] {
  if (v === undefined || v === null) {
    return [];
  }
  return Array.isArray(v) ? v : [v];
}

/**
 * Wydobywa tekst skalarny z wartości xml2js (string lub `{_, atrybuty}`).
 * @param {unknown} v - Wartość z xml2js
 * @returns {string | undefined} Przycięty tekst lub undefined gdy brak
 */
function xmlText(v: unknown): string | undefined {
  if (v === undefined || v === null) {
    return undefined;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? undefined : t;
  }
  if (typeof v === 'object' && '_' in (v as Record<string, unknown>)) {
    return xmlText((v as Record<string, unknown>)._);
  }
  if (typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  return undefined;
}

/**
 * Pobiera etykietę z mapy słownikowej; fallback do surowego kodu.
 * @param {TLabelMap} map - Mapa kod→etykieta
 * @param {string | undefined} code - Kod z XML
 * @returns {string | undefined} Etykieta, surowy kod lub undefined
 */
function label(map: TLabelMap, code: string | undefined): string | undefined {
  if (code === undefined) {
    return undefined;
  }
  return map[code] ?? code;
}

/**
 * Formatuje datę z ISO na DD.MM.YYYY (zwraca undefined dla pustej wartości).
 * @param {string | undefined} dateString - Data ISO
 * @returns {string | undefined} Sformatowana data lub undefined
 */
function optDate(dateString: string | undefined): string | undefined {
  if (!dateString) {
    return undefined;
  }
  return formatDate(dateString);
}

/**
 * Formatuje datę z formatu ISO na DD.MM.YYYY.
 * @param {string | undefined} dateString - Data w formacie ISO
 * @returns {string} Sformatowana data (pusty string dla braku)
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
 * Formatuje stawkę VAT (liczbową → "23%", tekstową "zw."/"np." bez zmian).
 * @param {string | undefined} stawka - Wartość P_12
 * @returns {string} Sformatowana stawka
 */
function formatStawka(stawka: string | undefined): string {
  if (!stawka) {
    return '';
  }
  const num = parseFloat(stawka);
  return Number.isNaN(num) ? stawka : `${formatAmount(num, 0)}%`;
}

/**
 * Formatuje kwotę z separatorami tysięcy i miejscami po przecinku (pl-PL).
 * @param {string|number|undefined|null} amount - Kwota do sformatowania
 * @param {number} decimals - Liczba miejsc po przecinku (domyślnie 2)
 * @returns {string} Sformatowana kwota
 */
function formatAmount(amount: string | number | undefined | null, decimals: number = 2): string {
  if (amount === undefined || amount === null || amount === '') {
    return (0).toLocaleString('pl-PL', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (Number.isNaN(numAmount)) {
    return (0).toLocaleString('pl-PL', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  return numAmount.toLocaleString('pl-PL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Formatuje adres z dostępnych pól (AdresL1, AdresL2, KodKraju).
 * @param {IAddress | undefined} adres - Obiekt adresu
 * @returns {string} Sformatowany adres
 */
function formatAddress(adres: IAddress | undefined): string {
  if (!adres) {
    return '';
  }

  const parts: string[] = [];

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
