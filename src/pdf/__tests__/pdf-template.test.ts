import { describe, expect, it } from 'vitest';
import { buildInvoicePdfDocDefinition, INVOICE_PDF_STYLES } from '../pdf-template.ts';
import type { IInvoiceData } from '../xml-parser.ts';

// --------------------------------------------------------------------------
// Fixture
// --------------------------------------------------------------------------

const INVOICE: IInvoiceData = {
  formularz: { kod: 'FA (3)', wariant: '3', dataWytworzenia: '04.02.2026', systemInfo: 'Test' },
  numerFaktury: 'FV/2026/02/001',
  numerKSeF: '20260203-EH-ABC123-EE',
  rodzajFaktury: undefined,
  dataWystawienia: '04.02.2026',
  dataSprzedazy: '03.02.2026',
  waluta: 'PLN',
  sprzedawca: {
    nazwa: 'Ćmielów Sp. z o.o.',
    nip: '5252674798',
    adres: 'ul. Łąkowa 1, 00-001 Łódź, PL',
  },
  nabywca: {
    nazwa: 'Żółć S.A.',
    nip: '1234567890',
    adres: 'ul. Śliska 2, 00-002 Gdańsk, PL',
  },
  podmiotyTrzecie: [],
  pozycje: [
    {
      lp: '1',
      nazwa: 'Usługa A',
      jednostka: 'szt',
      ilosc: '1',
      cenaNetto: '1 000,00',
      wartoscNetto: '1 000,00',
      stawkaVAT: '23%',
      kwotaVAT: '230,00',
      zal15: false,
    },
    {
      lp: '2',
      nazwa: 'Towar B',
      jednostka: 'szt',
      ilosc: '1',
      cenaNetto: '200,00',
      wartoscNetto: '200,00',
      stawkaVAT: '8%',
      kwotaVAT: '16,00',
      zal15: false,
    },
    {
      lp: '3',
      nazwa: 'Usługa C',
      jednostka: 'szt',
      ilosc: '1',
      cenaNetto: '100,00',
      wartoscNetto: '100,00',
      stawkaVAT: '23%',
      kwotaVAT: '23,00',
      zal15: false,
    },
  ],
  rekapitulacja: [
    { stawka: '23% (22%)', netto: '1 100,00', vat: '253,00', brutto: '1 353,00' },
    { stawka: '8% (7%)', netto: '200,00', vat: '16,00', brutto: '216,00' },
  ],
  podsumowanie: { netto: '1 300,00', vat: '283,00', brutto: '1 583,00' },
  adnotacje: [],
  dodatkowyOpis: [],
  rozliczenie: undefined,
  platnosc: undefined,
  stopka: undefined,
};

/**
 * Formatuje kwotę identycznie jak pdf-template (odporne na różne wersje ICU).
 */
function pln(value: number): string {
  return value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Pomocniczo: znajduje pierwszy element content z tabelą o danej liczbie kolumn.
 */
function findTable(content: unknown[], widthsLen: number): { table: { body: unknown[][] } } {
  const found = content.find(
    (c) =>
      typeof c === 'object' &&
      c !== null &&
      'table' in c &&
      Array.isArray((c as { table: { widths: unknown[] } }).table.widths) &&
      (c as { table: { widths: unknown[] } }).table.widths.length === widthsLen,
  );
  if (!found) {
    throw new Error(`Nie znaleziono tabeli o ${widthsLen} kolumnach`);
  }
  return found as { table: { body: unknown[][] } };
}

// --------------------------------------------------------------------------
// buildInvoicePdfDocDefinition
// --------------------------------------------------------------------------

describe('buildInvoicePdfDocDefinition', () => {
  it('powinien ustawić A4 i font Roboto', () => {
    const dd = buildInvoicePdfDocDefinition(INVOICE);

    expect(dd.pageSize).toBe('A4');
    expect((dd.defaultStyle as { font: string }).font).toBe('Roboto');
  });

  it('powinien zawierać 5 sekcji content gdy brak sekcji opcjonalnych', () => {
    const dd = buildInvoicePdfDocDefinition(INVOICE);

    expect(Array.isArray(dd.content)).toBe(true);
    expect((dd.content as unknown[]).length).toBe(5);
  });

  it('powinien umieścić numer faktury i numer KSeF w nagłówku', () => {
    const dd = buildInvoicePdfDocDefinition(INVOICE);
    const json = JSON.stringify((dd.content as unknown[])[0]);

    expect(json).toContain('FAKTURA NR FV/2026/02/001');
    expect(json).toContain('Numer KSeF: 20260203-EH-ABC123-EE');
  });

  it('powinien użyć etykiety rodzaju faktury w tytule gdy obecna', () => {
    const dd = buildInvoicePdfDocDefinition({ ...INVOICE, rodzajFaktury: 'Faktura korygująca' });
    const json = JSON.stringify((dd.content as unknown[])[0]);

    expect(json).toContain('FAKTURA KORYGUJĄCA NR FV/2026/02/001');
  });

  it('powinien zbudować tabelę pozycji (9 kolumn, 1 nagłówek + 3 wiersze)', () => {
    const dd = buildInvoicePdfDocDefinition(INVOICE);
    const table = findTable(dd.content as unknown[], 9);

    expect(table.table.body.length).toBe(4);
    const headerJson = JSON.stringify(table.table.body[0]);
    expect(headerJson).not.toContain('PKWiU');
    expect(headerJson).toContain('Wartość brutto');
  });

  it('powinien wyliczyć wartość brutto pozycji jako netto + VAT', () => {
    const dd = buildInvoicePdfDocDefinition(INVOICE);
    const table = findTable(dd.content as unknown[], 9);
    const row1 = JSON.stringify(table.table.body[1]);

    expect(row1).toContain(pln(1230));
  });

  it('powinien dodać kolumnę "Data wyk." gdy pozycja ma datę wykonania', () => {
    const withDate: IInvoiceData = {
      ...INVOICE,
      pozycje: [{ ...INVOICE.pozycje[0], dataWykonania: '30.04.2026' }],
    };
    const dd = buildInvoicePdfDocDefinition(withDate);
    const table = findTable(dd.content as unknown[], 10);

    expect(JSON.stringify(table.table.body[0])).toContain('Data wyk.');
  });

  it('powinien zbudować rekapitulację z danych autorytatywnych + RAZEM', () => {
    const dd = buildInvoicePdfDocDefinition(INVOICE);
    const recap = findTable(dd.content as unknown[], 4);

    expect(recap.table.body.length).toBe(4); // nagłówek + 23% + 8% + RAZEM
    expect(JSON.stringify(recap.table.body[1])).toContain('23% (22%)');
    const razem = JSON.stringify(recap.table.body[3]);
    expect(razem).toContain('RAZEM');
    expect(razem).toContain('1 300,00');
    expect(razem).toContain('283,00');
    expect(razem).toContain('1 583,00');
  });

  it('powinien pokazać "Do zapłaty" = brutto gdy brak rozliczenia i płatności', () => {
    const dd = buildInvoicePdfDocDefinition(INVOICE);
    const json = JSON.stringify(dd.content as unknown[]);

    expect(json).toContain('Do zapłaty: 1 583,00 PLN');
  });

  it('powinien użyć Rozliczenie/DoZaplaty jako kwoty do zapłaty (źródło prawdy)', () => {
    const dd = buildInvoicePdfDocDefinition({
      ...INVOICE,
      rozliczenie: {
        obciazenia: [],
        odliczenia: [{ kwota: '-89,94', powod: 'Nadwyżka' }],
        sumaOdliczen: '-89,94',
        doZaplaty: '0,00',
      },
    });
    const json = JSON.stringify(dd.content as unknown[]);

    expect(json).toContain('Do zapłaty: 0,00 PLN');
    expect(json).toContain('ROZLICZENIE');
  });

  it('powinien pokazać "ZAPŁACONO" gdy płatność oznaczona jako zapłacona', () => {
    const dd = buildInvoicePdfDocDefinition({
      ...INVOICE,
      platnosc: { zaplacono: true, dataZaplaty: '10.02.2026', terminy: [], rachunki: [] },
    });
    const json = JSON.stringify(dd.content as unknown[]);

    expect(json).toContain('ZAPŁACONO (10.02.2026)');
    expect(json).not.toContain('Do zapłaty:');
  });

  it('powinien pokazać nadpłatę do rozliczenia (DoRozliczenia)', () => {
    const dd = buildInvoicePdfDocDefinition({
      ...INVOICE,
      rozliczenie: { obciazenia: [], odliczenia: [], doRozliczenia: '343,24' },
    });
    const json = JSON.stringify(dd.content as unknown[]);

    expect(json).toContain('Nadpłata do rozliczenia: 343,24 PLN');
  });

  it('powinien renderować sekcję płatności gdy obecna', () => {
    const dd = buildInvoicePdfDocDefinition({
      ...INVOICE,
      platnosc: {
        zaplacono: false,
        forma: 'Przelew',
        terminy: [{ termin: '15.02.2026' }],
        rachunki: [{ nrRB: '62114016291748000084771506', nazwaBanku: 'Bank Testowy' }],
      },
    });
    const json = JSON.stringify(dd.content as unknown[]);

    expect(json).toContain('Forma płatności: Przelew');
    expect(json).toContain('Termin płatności: 15.02.2026');
    expect(json).toContain('62114016291748000084771506');
  });

  it('powinien renderować stopkę z notą i rejestrami', () => {
    const dd = buildInvoicePdfDocDefinition({
      ...INVOICE,
      stopka: {
        informacje: ['Uwaga dot. salda'],
        dodatkowyOpis: [],
        rejestry: { krs: '0000010681', regon: '012100784', bdo: '000028832' },
      },
    });
    const json = JSON.stringify(dd.content as unknown[]);

    expect(json).toContain('Uwaga dot. salda');
    expect(json).toContain('KRS 0000010681 · REGON 012100784 · BDO 000028832');
  });

  it('powinien renderować linię adnotacji gdy obecne', () => {
    const dd = buildInvoicePdfDocDefinition({ ...INVOICE, adnotacje: ['Mechanizm podzielonej płatności'] });
    const json = JSON.stringify(dd.content as unknown[]);

    expect(json).toContain('Adnotacje: Mechanizm podzielonej płatności');
  });

  it('powinien obsłużyć fakturę bez pozycji (kolumny dynamiczne zwężone, sam nagłówek)', () => {
    const dd = buildInvoicePdfDocDefinition({ ...INVOICE, pozycje: [], rekapitulacja: [] });
    // brak pozycji → kolumny opcjonalne (JM/Ilość/Cena netto) znikają: 6 stałych
    const items = findTable(dd.content as unknown[], 6);
    const recap = findTable(dd.content as unknown[], 4);

    expect(items.table.body.length).toBe(1);
    expect(JSON.stringify(items.table.body[0])).toContain('Wartość brutto');
    expect(recap.table.body.length).toBe(2); // nagłówek + RAZEM
  });

  it('powinien eksponować zamrożone style', () => {
    expect(Object.isFrozen(INVOICE_PDF_STYLES)).toBe(true);
    expect(INVOICE_PDF_STYLES.header.bold).toBe(true);
  });
});
