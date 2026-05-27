/**
 * Budowanie definicji dokumentu pdfmake dla faktury KSeF (FA(3)).
 * Czysta warstwa prezentacji — mapuje IInvoiceData na strukturę pdfmake.
 * Sekcje renderowane wyłącznie gdy odpowiednie dane są obecne w XML.
 */

import type { Content, StyleDictionary, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { IInvoiceData, IInvoiceItem } from './xml-parser.ts';

/**
 * Słownik stylów PDF faktury. Wszystkie rozmiary/wagi/kolory w jednym miejscu.
 */
type TInvoicePdfStyles = {
  readonly header: StyleDictionary[string];
  readonly subheader: StyleDictionary[string];
  readonly metaLabel: StyleDictionary[string];
  readonly sectionLabel: StyleDictionary[string];
  readonly partyName: StyleDictionary[string];
  readonly tableHeader: StyleDictionary[string];
  readonly tableCell: StyleDictionary[string];
  readonly recapHeader: StyleDictionary[string];
  readonly totalsLabel: StyleDictionary[string];
  readonly totalsValue: StyleDictionary[string];
  readonly grandTotal: StyleDictionary[string];
  readonly annotation: StyleDictionary[string];
  readonly paymentLabel: StyleDictionary[string];
  readonly paidBadge: StyleDictionary[string];
  readonly footerNote: StyleDictionary[string];
  readonly registryLine: StyleDictionary[string];
};

/**
 * Style dokumentu PDF faktury (konwencja Object.freeze<Type>).
 */
export const INVOICE_PDF_STYLES = Object.freeze<TInvoicePdfStyles>({
  header: { fontSize: 18, bold: true },
  subheader: { fontSize: 10, color: '#555555' },
  metaLabel: { fontSize: 9, color: '#555555' },
  sectionLabel: { fontSize: 9, bold: true, color: '#555555', margin: [0, 0, 0, 2] },
  partyName: { fontSize: 11, bold: true },
  tableHeader: { fontSize: 8, bold: true, fillColor: '#eeeeee' },
  tableCell: { fontSize: 8 },
  recapHeader: { fontSize: 8, bold: true, fillColor: '#eeeeee' },
  totalsLabel: { fontSize: 10, alignment: 'right' },
  totalsValue: { fontSize: 10, alignment: 'right' },
  grandTotal: { fontSize: 12, bold: true, alignment: 'right' },
  annotation: { fontSize: 9, color: '#333333' },
  paymentLabel: { fontSize: 9 },
  paidBadge: { fontSize: 12, bold: true, color: '#1a7f37', alignment: 'right' },
  footerNote: { fontSize: 7, color: '#666666' },
  registryLine: { fontSize: 7, color: '#888888' },
});

/**
 * Formatuje liczbę jako kwotę pl-PL (spacja tysięcy, przecinek, 2 miejsca).
 * @param {number} value - Kwota do sformatowania
 * @returns {string} Sformatowana kwota, np. "1 234,56"
 */
function formatPln(value: number): string {
  return value.toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Parsuje sformatowaną kwotę pl-PL z xml-parser na liczbę.
 * @param {string} value - Kwota jako string, np. "1 234,56"
 * @returns {number} Wartość liczbowa; 0 dla wartości nieparsowalnych
 */
function parsePlnAmount(value: string): number {
  // Usuń wszystko poza cyframi, znakiem minus i przecinkiem (separatory
  // tysięcy: spacja/NBSP/wąski NBSP), następnie przecinek → kropka.
  const normalized = value.replace(/[^\d,-]/g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Buduje nagłówek faktury (numer + rodzaj + numer KSeF | daty/okres).
 * @param {IInvoiceData} data - Dane faktury
 * @returns {Content} Sekcja nagłówka pdfmake
 */
function buildHeader(data: IInvoiceData): Content {
  const tytul = data.rodzajFaktury
    ? `${data.rodzajFaktury.toUpperCase()} NR ${data.numerFaktury}`
    : `FAKTURA NR ${data.numerFaktury}`;

  const meta: Content[] = [
    { text: `Data wystawienia: ${data.dataWystawienia}`, style: 'metaLabel', alignment: 'right' },
  ];
  if (data.miejsceWystawienia) {
    meta.push({ text: `Miejsce wystawienia: ${data.miejsceWystawienia}`, style: 'metaLabel', alignment: 'right' });
  }
  if (data.okres) {
    meta.push({ text: `Okres: ${data.okres.od} – ${data.okres.do}`, style: 'metaLabel', alignment: 'right' });
  } else if (data.dataSprzedazy) {
    meta.push({ text: `Data sprzedaży: ${data.dataSprzedazy}`, style: 'metaLabel', alignment: 'right' });
  }

  return {
    columns: [
      {
        width: '*',
        stack: [
          { text: tytul, style: 'header' },
          { text: `Numer KSeF: ${data.numerKSeF}`, style: 'subheader', margin: [0, 2, 0, 0] },
        ],
      },
      { width: 'auto', stack: meta },
    ],
    margin: [0, 0, 0, 16],
  };
}

/**
 * Buduje stos linii dla jednej strony transakcji.
 * @param {string} label - Etykieta sekcji ("SPRZEDAWCA"/"NABYWCA")
 * @param {IInvoiceData['sprzedawca']} party - Dane strony
 * @returns {Content} Kolumna strony
 */
function buildPartyColumn(label: string, party: IInvoiceData['sprzedawca']): Content {
  const stack: Content[] = [
    { text: label, style: 'sectionLabel' },
    { text: party.nazwa, style: 'partyName' },
  ];
  if (party.nip) {
    stack.push({ text: `NIP: ${party.prefiks ?? ''}${party.nip}`, fontSize: 9 });
  }
  if (party.adres) {
    stack.push({ text: party.adres, fontSize: 9 });
  }
  if (party.nrKlienta) {
    stack.push({ text: `Nr klienta: ${party.nrKlienta}`, fontSize: 9 });
  }
  const kontakt = [party.email, party.telefon].filter(Boolean).join(' · ');
  if (kontakt) {
    stack.push({ text: kontakt, fontSize: 9 });
  }
  return { width: '*', stack } as Content;
}

/**
 * Buduje sekcję stron transakcji (sprzedawca | nabywca) + podmioty trzecie.
 * @param {IInvoiceData} data - Dane faktury
 * @returns {Content} Sekcja stron transakcji
 */
function buildParties(data: IInvoiceData): Content {
  const stack: Content[] = [
    {
      columns: [buildPartyColumn('SPRZEDAWCA', data.sprzedawca), buildPartyColumn('NABYWCA', data.nabywca)],
      columnGap: 24,
    },
  ];

  for (const tp of data.podmiotyTrzecie) {
    const nip = tp.nip ? ` (NIP: ${tp.nip})` : '';
    const adres = tp.adres ? `, ${tp.adres}` : '';
    stack.push({ text: `${tp.rola}: ${tp.nazwa}${nip}${adres}`, fontSize: 9, margin: [0, 6, 0, 0] });
  }

  return { stack, margin: [0, 0, 0, 16] };
}

/**
 * Buduje linię adnotacji (pomija sekcję, gdy brak aktywnych adnotacji).
 * @param {IInvoiceData} data - Dane faktury
 * @returns {Content | null} Sekcja adnotacji lub null
 */
function buildAdnotacje(data: IInvoiceData): Content | null {
  if (data.adnotacje.length === 0) {
    return null;
  }
  return {
    text: `Adnotacje: ${data.adnotacje.join(' · ')}`,
    style: 'annotation',
    margin: [0, 0, 0, 12],
  };
}

/**
 * Opis kolumny tabeli pozycji (etykieta + selektor wartości + obecność).
 */
type TItemColumn = {
  readonly head: string;
  readonly width: string;
  readonly align: 'left' | 'right';
  readonly value: (item: IInvoiceItem) => string;
  readonly present: (data: IInvoiceData) => boolean;
};

/**
 * Definicje kolumn tabeli pozycji. Kolumny opcjonalne renderowane tylko
 * gdy którakolwiek pozycja zawiera dane.
 */
const ITEM_COLUMNS: readonly TItemColumn[] = [
  { head: 'L.p.', width: 'auto', align: 'left', value: (i) => i.lp, present: () => true },
  {
    head: 'Indeks',
    width: 'auto',
    align: 'left',
    value: (i) => i.indeks ?? '',
    present: (d) => d.pozycje.some((i) => i.indeks),
  },
  { head: 'Nazwa towaru/usługi', width: '*', align: 'left', value: (i) => i.nazwa, present: () => true },
  {
    head: 'GTU',
    width: 'auto',
    align: 'left',
    value: (i) => i.gtu ?? '',
    present: (d) => d.pozycje.some((i) => i.gtu),
  },
  {
    head: 'Data wyk.',
    width: 'auto',
    align: 'left',
    value: (i) => i.dataWykonania ?? '',
    present: (d) => d.pozycje.some((i) => i.dataWykonania),
  },
  {
    head: 'J.M.',
    width: 'auto',
    align: 'left',
    value: (i) => i.jednostka ?? '',
    present: (d) => d.pozycje.some((i) => i.jednostka),
  },
  {
    head: 'Ilość',
    width: 'auto',
    align: 'right',
    value: (i) => i.ilosc ?? '',
    present: (d) => d.pozycje.some((i) => i.ilosc),
  },
  {
    head: 'Cena netto',
    width: 'auto',
    align: 'right',
    value: (i) => i.cenaNetto ?? '',
    present: (d) => d.pozycje.some((i) => i.cenaNetto),
  },
  {
    head: 'Rabat',
    width: 'auto',
    align: 'right',
    value: (i) => i.rabat ?? '',
    present: (d) => d.pozycje.some((i) => i.rabat),
  },
  { head: 'Wartość netto', width: 'auto', align: 'right', value: (i) => i.wartoscNetto, present: () => true },
  { head: 'Stawka VAT', width: 'auto', align: 'right', value: (i) => i.stawkaVAT, present: () => true },
  { head: 'Kwota VAT', width: 'auto', align: 'right', value: (i) => i.kwotaVAT, present: () => true },
  {
    head: 'Wartość brutto',
    width: 'auto',
    align: 'right',
    value: (i) => i.wartoscBrutto ?? formatPln(parsePlnAmount(i.wartoscNetto) + parsePlnAmount(i.kwotaVAT)),
    present: () => true,
  },
];

/**
 * Buduje tabelę pozycji faktury (kolumny dynamiczne, łamanie wielostronicowe).
 * @param {IInvoiceData} data - Dane faktury
 * @returns {Content} Tabela pozycji pdfmake
 */
function buildItemsTable(data: IInvoiceData): Content {
  const cols = ITEM_COLUMNS.filter((c) => c.present(data));

  const head = cols.map((c) => ({ text: c.head, style: 'tableHeader' }));
  const rows = data.pozycje.map((item) =>
    cols.map((c) => ({ text: c.value(item), style: 'tableCell', alignment: c.align })),
  );

  return {
    table: {
      headerRows: 1,
      widths: cols.map((c) => c.width),
      body: [head, ...rows],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 16],
  };
}

/**
 * Buduje tabelę rekapitulacji VAT (z autorytatywnych pól + RAZEM).
 * @param {IInvoiceData} data - Dane faktury
 * @returns {Content} Tabela rekapitulacji VAT
 */
function buildVatRecap(data: IInvoiceData): Content {
  const head = ['Stawka', 'Wartość netto', 'Kwota VAT', 'Wartość brutto'].map((text) => ({
    text,
    style: 'recapHeader',
  }));

  const recapRows = data.rekapitulacja.map((row) => [
    { text: row.stawka, style: 'tableCell' },
    { text: row.netto, style: 'tableCell', alignment: 'right' },
    { text: row.vat, style: 'tableCell', alignment: 'right' },
    { text: row.brutto, style: 'tableCell', alignment: 'right' },
  ]);

  const totalRow = [
    { text: 'RAZEM', style: 'tableCell', bold: true },
    { text: data.podsumowanie.netto, style: 'tableCell', alignment: 'right', bold: true },
    { text: data.podsumowanie.vat, style: 'tableCell', alignment: 'right', bold: true },
    { text: data.podsumowanie.brutto, style: 'tableCell', alignment: 'right', bold: true },
  ];

  return {
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto'],
      body: [head, ...recapRows, totalRow],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 16],
  };
}

/**
 * Buduje sekcję warunków płatności (pomija, gdy brak danych Platnosc).
 * @param {IInvoiceData} data - Dane faktury
 * @returns {Content | null} Sekcja płatności lub null
 */
function buildPayment(data: IInvoiceData): Content | null {
  const p = data.platnosc;
  if (!p) {
    return null;
  }

  const lines: Content[] = [{ text: 'PŁATNOŚĆ', style: 'sectionLabel' }];

  if (p.forma) {
    lines.push({ text: `Forma płatności: ${p.forma}`, style: 'paymentLabel' });
  }
  if (p.opisPlatnosci) {
    lines.push({ text: `Opis płatności: ${p.opisPlatnosci}`, style: 'paymentLabel' });
  }
  for (const t of p.terminy) {
    const parts = [t.termin ? `Termin płatności: ${t.termin}` : undefined, t.opis].filter(Boolean);
    if (parts.length > 0) {
      lines.push({ text: parts.join(' — '), style: 'paymentLabel' });
    }
  }
  for (const rb of p.rachunki) {
    const extra = [rb.nazwaBanku, rb.swift, rb.opis].filter(Boolean).join(', ');
    lines.push({
      text: `Rachunek: ${rb.nrRB}${extra ? ` (${extra})` : ''}`,
      style: 'paymentLabel',
    });
  }
  if (p.zaplacono) {
    lines.push({
      text: p.dataZaplaty ? `Zapłacono dnia ${p.dataZaplaty}` : 'Zapłacono',
      style: 'paymentLabel',
      bold: true,
      color: '#1a7f37',
    });
  }

  if (lines.length === 1) {
    return null;
  }
  return { stack: lines, margin: [0, 0, 0, 12] };
}

/**
 * Buduje sekcję Rozliczenie (obciążenia/odliczenia + saldo).
 * @param {IInvoiceData} data - Dane faktury
 * @returns {Content | null} Sekcja rozliczenia lub null
 */
function buildSettlement(data: IInvoiceData): Content | null {
  const r = data.rozliczenie;
  if (!r) {
    return null;
  }

  const body: Content[][] = [['Rodzaj', 'Powód', 'Kwota'].map((text) => ({ text, style: 'recapHeader' }))];

  for (const o of r.obciazenia) {
    body.push([
      { text: 'Obciążenie', style: 'tableCell' },
      { text: o.powod, style: 'tableCell' },
      { text: o.kwota, style: 'tableCell', alignment: 'right' },
    ]);
  }
  for (const o of r.odliczenia) {
    body.push([
      { text: 'Odliczenie', style: 'tableCell' },
      { text: o.powod, style: 'tableCell' },
      { text: o.kwota, style: 'tableCell', alignment: 'right' },
    ]);
  }

  if (body.length === 1 && !r.sumaObciazen && !r.sumaOdliczen) {
    return null;
  }

  const stack: Content[] = [
    { text: 'ROZLICZENIE', style: 'sectionLabel' },
    {
      table: { headerRows: 1, widths: ['auto', '*', 'auto'], body },
      layout: 'lightHorizontalLines',
    },
  ];

  if (r.sumaObciazen) {
    stack.push({ text: `Suma obciążeń: ${r.sumaObciazen} ${data.waluta}`, style: 'totalsLabel' });
  }
  if (r.sumaOdliczen) {
    stack.push({ text: `Suma odliczeń: ${r.sumaOdliczen} ${data.waluta}`, style: 'totalsLabel' });
  }

  return { stack, margin: [0, 0, 0, 12] };
}

/**
 * Buduje blok podsumowania z logiką źródła prawdy dla kwoty „Do zapłaty".
 * @param {IInvoiceData} data - Dane faktury
 * @returns {Content} Sekcja podsumowania
 */
function buildTotals(data: IInvoiceData): Content {
  const stack: Content[] = [
    { text: `Razem netto: ${data.podsumowanie.netto} ${data.waluta}`, style: 'totalsLabel' },
    { text: `Kwota VAT: ${data.podsumowanie.vat} ${data.waluta}`, style: 'totalsValue' },
    { text: `Wartość brutto: ${data.podsumowanie.brutto} ${data.waluta}`, style: 'totalsValue' },
  ];

  if (data.platnosc?.zaplacono) {
    stack.push({
      text: data.platnosc.dataZaplaty ? `ZAPŁACONO (${data.platnosc.dataZaplaty})` : 'ZAPŁACONO',
      style: 'paidBadge',
      margin: [0, 4, 0, 0],
    });
  } else if (data.rozliczenie?.doRozliczenia !== undefined) {
    stack.push({
      text: `Nadpłata do rozliczenia: ${data.rozliczenie.doRozliczenia} ${data.waluta}`,
      style: 'grandTotal',
      margin: [0, 4, 0, 0],
    });
  } else {
    const kwota = data.rozliczenie?.doZaplaty ?? data.podsumowanie.brutto;
    stack.push({
      text: `Do zapłaty: ${kwota} ${data.waluta}`,
      style: 'grandTotal',
      margin: [0, 4, 0, 0],
    });
  }

  return { stack, margin: [0, 0, 0, 12] };
}

/**
 * Buduje stopkę faktury (noty + rejestry sprzedawcy).
 * @param {IInvoiceData} data - Dane faktury
 * @returns {Content | null} Sekcja stopki lub null
 */
function buildFooter(data: IInvoiceData): Content | null {
  const s = data.stopka;
  if (!s) {
    return null;
  }

  const stack: Content[] = [];

  for (const info of s.informacje) {
    stack.push({ text: info, style: 'footerNote' });
  }
  for (const kv of s.dodatkowyOpis) {
    stack.push({ text: `${kv.klucz}: ${kv.wartosc}`, style: 'footerNote' });
  }
  if (s.rejestry) {
    const parts = [
      s.rejestry.krs ? `KRS ${s.rejestry.krs}` : undefined,
      s.rejestry.regon ? `REGON ${s.rejestry.regon}` : undefined,
      s.rejestry.bdo ? `BDO ${s.rejestry.bdo}` : undefined,
    ].filter(Boolean);
    if (parts.length > 0) {
      stack.push({ text: parts.join(' · '), style: 'registryLine', margin: [0, 4, 0, 0] });
    }
  }

  if (stack.length === 0) {
    return null;
  }
  return { stack, margin: [0, 16, 0, 0] };
}

/**
 * Buduje pełną definicję dokumentu pdfmake dla faktury.
 * @param {IInvoiceData} data - Zmapowane dane faktury z xml-parser
 * @returns {TDocumentDefinitions} Definicja dokumentu gotowa dla PdfPrinter
 */
export function buildInvoicePdfDocDefinition(data: IInvoiceData): TDocumentDefinitions {
  const content: Content[] = [
    buildHeader(data),
    buildParties(data),
    buildAdnotacje(data),
    buildItemsTable(data),
    buildVatRecap(data),
    buildPayment(data),
    buildSettlement(data),
    buildTotals(data),
    buildFooter(data),
  ].filter((section): section is Content => section !== null);

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    styles: INVOICE_PDF_STYLES as StyleDictionary,
    content,
  };
}
