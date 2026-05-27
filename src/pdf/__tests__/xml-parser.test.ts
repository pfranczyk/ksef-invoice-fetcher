import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapInvoiceData, parseInvoiceXml } from '../xml-parser.ts';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockFns = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: { readFile: mockFns.readFile },
}));

vi.mock('../../utils/logger.ts', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  maskSensitiveData: vi.fn((s: string) => s),
}));

// --------------------------------------------------------------------------
// Fixtures — obiekty symulujące output xml2js (explicitArray:false, mergeAttrs:true)
// --------------------------------------------------------------------------

const PARSED_SINGLE_ITEM = {
  Faktura: {
    Naglowek: {
      KodFormularza: { _: 'FA', kodSystemowy: 'FA (3)', wersjaSchemy: '1-0E' },
      WariantFormularza: '3',
      DataWytworzeniaFa: '2026-01-15T10:00:00+01:00',
      SystemInfo: 'TestSystem',
    },
    Podmiot1: {
      DaneIdentyfikacyjne: { NIP: '1111111111', Nazwa: 'ACME Systemy Sp. z o.o.' },
      Adres: { AdresL1: 'ul. Testowa 1', AdresL2: '00-001 Warszawa', KodKraju: 'PL' },
    },
    Podmiot2: {
      DaneIdentyfikacyjne: { NIP: '2222222222', Nazwa: 'Nabywca Testowy Sp. z o.o.' },
      Adres: { AdresL1: 'ul. Nabywcowa 5', KodKraju: 'PL' },
      NrKlienta: '00012345',
    },
    Fa: {
      P_2: 'FV/2026/001',
      P_1: '2026-01-15',
      KodWaluty: 'PLN',
      RodzajFaktury: 'VAT',
      P_13_1: '100.00',
      P_14_1: '23.00',
      P_15: '123.00',
      FaWiersz: {
        NrWierszaFa: '1',
        P_7: 'Usługa testowa',
        P_8A: 'szt',
        P_8B: '1',
        P_9A: '100.00',
        P_11: '100.00',
        P_12: '23',
      },
    },
  },
};

const PARSED_MULTI_RATES = {
  Faktura: {
    Naglowek: { DataWytworzeniaFa: '2026-02-01' },
    Podmiot1: {
      DaneIdentyfikacyjne: { NIP: '3333333333', Nazwa: 'Sprzedawca Multi Sp. z o.o.' },
      Adres: { AdresL1: 'ul. Multi 10' },
    },
    Podmiot2: {
      DaneIdentyfikacyjne: { NIP: '4444444444', Nazwa: 'Nabywca Multi Sp. z o.o.' },
      Adres: {},
    },
    Fa: {
      P_2: 'FV/2026/002',
      P_1: '2026-02-01',
      KodWaluty: 'EUR',
      P_13_1: '300.00',
      P_14_1: '69.00',
      P_13_2: '100.00',
      P_14_2: '8.00',
      P_13_7: '50.00',
      P_15: '527.00',
      FaWiersz: [
        { NrWierszaFa: '1', P_7: 'Pozycja 23%', P_8A: 'szt', P_8B: '2', P_9A: '150.00', P_11: '300.00', P_12: '23' },
        { NrWierszaFa: '2', P_7: 'Pozycja 8%', P_8A: 'kg', P_8B: '5', P_9A: '20.00', P_11: '100.00', P_12: '8' },
        { NrWierszaFa: '3', P_7: 'Pozycja zw.', P_8A: 'h', P_8B: '1', P_9A: '50.00', P_11: '50.00', P_12: 'zw' },
      ],
    },
  },
};

const PARSED_GROSS_ONLY = {
  Faktura: {
    Naglowek: {},
    Podmiot1: { DaneIdentyfikacyjne: {}, Adres: {} },
    Podmiot2: { DaneIdentyfikacyjne: {}, Adres: {} },
    Fa: {
      P_2: 'FV/2026/003',
      P_1: '2026-03-01',
      P_15: '123.00',
      FaWiersz: {
        P_7: 'Produkt z ceną brutto',
        P_8A: 'szt',
        P_8B: '1',
        P_11A: '123.00',
        P_12: '23',
      },
    },
  },
};

const PARSED_FA3_FULL = {
  Faktura: {
    Naglowek: { DataWytworzeniaFa: '2026-04-03', SystemInfo: 'OPL2KSeF' },
    Podmiot1: {
      DaneIdentyfikacyjne: { NIP: '5260250995', Nazwa: 'Orange Polska S.A.' },
      Adres: { KodKraju: 'PL', AdresL1: 'Al. Jerozolimskie 160', AdresL2: '02-326 Warszawa' },
    },
    Podmiot2: {
      DaneIdentyfikacyjne: { NIP: '6792695652', Nazwa: 'PAWEŁ FRANCZYK LOGNET' },
      Adres: { KodKraju: 'PL', AdresL1: 'DĄBROWA 387', AdresL2: '32-014 DĄBROWA' },
      NrKlienta: '00008477150604',
    },
    Podmiot3: {
      DaneIdentyfikacyjne: { NIP: '9999999999', Nazwa: 'Odbiorca Sp. z o.o.' },
      Adres: { AdresL1: 'ul. Odbiorcza 1', KodKraju: 'PL' },
      Rola: '2',
    },
    Fa: {
      KodWaluty: 'PLN',
      P_1: '2026-04-03',
      P_2: 'F0084771506/003/26',
      P_13_1: '73.12',
      P_14_1: '16.82',
      P_15: '89.94',
      Adnotacje: {
        P_16: '2',
        P_17: '2',
        P_18: '2',
        P_18A: '2',
        Zwolnienie: { P_19N: '1' },
        PMarzy: { P_PMarzyN: '1' },
      },
      RodzajFaktury: 'VAT',
      FaWiersz: [
        {
          NrWierszaFa: '1',
          P_6A: '2026-04-30',
          P_7: 'Internet',
          P_8A: 'usługa',
          P_8B: '1',
          P_9A: '78.15',
          P_11: '78.15',
          P_12: '23',
        },
        {
          NrWierszaFa: '2',
          P_6A: '2026-04-30',
          P_7: 'Rabat',
          P_8A: 'usługa',
          P_8B: '1',
          P_9A: '-4.03',
          P_11: '-4.03',
          P_12: '23',
        },
      ],
      Rozliczenie: {
        Odliczenia: { Kwota: '-89.94', Powod: 'Nadwyżka pomniejszająca kwotę faktury' },
        SumaOdliczen: '-89.94',
        DoZaplaty: '0.00',
      },
      Platnosc: {
        TerminPlatnosci: { Termin: '2026-04-15' },
        RachunekBankowy: { NrRB: '62114016291748000084771506' },
      },
    },
    Stopka: {
      Informacje: { StopkaFaktury: 'Uwaga! Informacja o saldzie.' },
      Rejestry: { KRS: '0000010681', REGON: '012100784', BDO: '000028832' },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------
// parseInvoiceXml
// --------------------------------------------------------------------------

describe('parseInvoiceXml', () => {
  it('powinien sparsować poprawny XML i zwrócić obiekt z kluczem Faktura', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura>
  <Naglowek><DataWytworzeniaFa>2026-01-15</DataWytworzeniaFa></Naglowek>
</Faktura>`;
    mockFns.readFile.mockResolvedValue(xml);

    const result = (await parseInvoiceXml('/output/01/invoice.xml')) as Record<string, unknown>;

    expect(result).toHaveProperty('Faktura');
    expect((result.Faktura as Record<string, unknown>).Naglowek).toBeDefined();
  });

  it('powinien rzucić błąd gdy odczyt pliku się nie powiódł', async () => {
    const fsError = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    mockFns.readFile.mockRejectedValue(fsError);

    await expect(parseInvoiceXml('/output/01/missing.xml')).rejects.toThrow('ENOENT');
  });

  it('powinien rzucić błąd gdy XML jest nieprawidłowy', async () => {
    mockFns.readFile.mockResolvedValue('<invalid><unclosed>');

    await expect(parseInvoiceXml('/output/01/bad.xml')).rejects.toThrow('Nie udało się sparsować XML:');
  });
});

// --------------------------------------------------------------------------
// mapInvoiceData — strony transakcji i nagłówek
// --------------------------------------------------------------------------

describe('mapInvoiceData — strony i nagłówek', () => {
  it('powinien zmapować NIPy, nazwy i adresy sprzedawcy i nabywcy', () => {
    const result = mapInvoiceData(PARSED_SINGLE_ITEM, 'FV_2026_001.xml');

    expect(result.sprzedawca.nip).toBe('1111111111');
    expect(result.sprzedawca.nazwa).toBe('ACME Systemy Sp. z o.o.');
    expect(result.sprzedawca.adres).toBe('ul. Testowa 1, 00-001 Warszawa, PL');
    expect(result.nabywca.nip).toBe('2222222222');
    expect(result.nabywca.nazwa).toBe('Nabywca Testowy Sp. z o.o.');
    expect(result.nabywca.adres).toBe('ul. Nabywcowa 5, PL');
  });

  it('powinien zmapować numer klienta nabywcy', () => {
    const result = mapInvoiceData(PARSED_SINGLE_ITEM, 'invoice.xml');

    expect(result.nabywca.nrKlienta).toBe('00012345');
  });

  it('powinien zmapować kod i wariant formularza z nagłówka', () => {
    const result = mapInvoiceData(PARSED_SINGLE_ITEM, 'invoice.xml');

    expect(result.formularz.kod).toBe('FA (3)');
    expect(result.formularz.wariant).toBe('3');
    expect(result.formularz.systemInfo).toBe('TestSystem');
  });

  it('powinien zmapować rodzaj faktury na etykietę czytelną', () => {
    const result = mapInvoiceData(PARSED_SINGLE_ITEM, 'invoice.xml');

    expect(result.rodzajFaktury).toBe('Faktura podstawowa');
  });

  it('powinien zmapować numer faktury i numer KSeF z nazwy pliku', () => {
    const result = mapInvoiceData(PARSED_SINGLE_ITEM, 'KSEF-12345678901234567890.xml');

    expect(result.numerFaktury).toBe('FV/2026/001');
    expect(result.numerKSeF).toBe('KSEF-12345678901234567890');
    expect(result.waluta).toBe('PLN');
  });

  it('powinien sformatować datę wystawienia i sprzedaży z ISO na DD.MM.YYYY', () => {
    const result = mapInvoiceData(PARSED_SINGLE_ITEM, 'invoice.xml');

    expect(result.dataWystawienia).toBe('15.01.2026');
    expect(result.dataSprzedazy).toBeUndefined();
  });

  it('powinien zwrócić pusty string daty wystawienia gdy P_1 jest undefined', () => {
    const parsed = {
      Faktura: {
        Naglowek: {},
        Podmiot1: { DaneIdentyfikacyjne: {}, Adres: {} },
        Podmiot2: { DaneIdentyfikacyjne: {}, Adres: {} },
        Fa: {},
      },
    };
    const result = mapInvoiceData(parsed, 'invoice.xml');

    expect(result.dataWystawienia).toBe('');
    expect(result.dataSprzedazy).toBeUndefined();
  });

  it('powinien zwrócić domyślną walutę PLN gdy KodWaluty jest nieokreślony', () => {
    const parsed = {
      Faktura: {
        Naglowek: {},
        Podmiot1: { DaneIdentyfikacyjne: {}, Adres: {} },
        Podmiot2: { DaneIdentyfikacyjne: {}, Adres: {} },
        Fa: {},
      },
    };
    const result = mapInvoiceData(parsed, 'invoice.xml');

    expect(result.waluta).toBe('PLN');
  });
});

// --------------------------------------------------------------------------
// mapInvoiceData — pozycje
// --------------------------------------------------------------------------

describe('mapInvoiceData — pozycje', () => {
  it('powinien zmapować jedną pozycję z P_11 (netto) z poprawną stawką VAT', () => {
    const result = mapInvoiceData(PARSED_SINGLE_ITEM, 'invoice.xml');

    expect(result.pozycje).toHaveLength(1);
    expect(result.pozycje[0].lp).toBe('1');
    expect(result.pozycje[0].nazwa).toBe('Usługa testowa');
    expect(result.pozycje[0].ilosc).toBe('1');
    expect(result.pozycje[0].jednostka).toBe('szt');
    expect(result.pozycje[0].cenaNetto).toBe('100,00');
    expect(result.pozycje[0].wartoscNetto).toBe('100,00');
    expect(result.pozycje[0].stawkaVAT).toBe('23%');
  });

  it('powinien obsłużyć FaWiersz jako obiekt (nie tablicę) i zwrócić jedną pozycję', () => {
    const result = mapInvoiceData(PARSED_SINGLE_ITEM, 'invoice.xml');

    expect(Array.isArray(result.pozycje)).toBe(true);
    expect(result.pozycje).toHaveLength(1);
  });

  it('powinien zmapować trzy pozycje z różnymi stawkami VAT', () => {
    const result = mapInvoiceData(PARSED_MULTI_RATES, 'invoice.xml');

    expect(result.pozycje).toHaveLength(3);
    expect(result.pozycje[0].stawkaVAT).toBe('23%');
    expect(result.pozycje[1].stawkaVAT).toBe('8%');
    expect(result.pozycje[2].stawkaVAT).toBe('zw');
    expect(result.waluta).toBe('EUR');
  });

  it('powinien zwrócić pustą tablicę pozycji gdy FaWiersz jest undefined', () => {
    const parsed = {
      Faktura: {
        Naglowek: {},
        Podmiot1: { DaneIdentyfikacyjne: {}, Adres: {} },
        Podmiot2: { DaneIdentyfikacyjne: {}, Adres: {} },
        Fa: { P_2: 'FV/001' },
      },
    };
    const result = mapInvoiceData(parsed, 'invoice.xml');

    expect(result.pozycje).toHaveLength(0);
  });

  it('powinien obliczyć cenę netto z brutto gdy brak P_11 (tylko P_11A)', () => {
    const result = mapInvoiceData(PARSED_GROSS_ONLY, 'invoice.xml');

    expect(result.pozycje).toHaveLength(1);
    const nettoNum = parseFloat(result.pozycje[0].wartoscNetto.replace(',', '.'));
    expect(nettoNum).toBeCloseTo(100, 1);
  });

  it('powinien zmapować datę wykonania pozycji (P_6A) i ujemny rabat', () => {
    const result = mapInvoiceData(PARSED_FA3_FULL, 'invoice.xml');

    expect(result.pozycje[0].dataWykonania).toBe('30.04.2026');
    expect(result.pozycje[1].wartoscNetto).toBe('-4,03');
  });
});

// --------------------------------------------------------------------------
// mapInvoiceData — rekapitulacja VAT (autorytatywna z P_13_x/P_14_x)
// --------------------------------------------------------------------------

describe('mapInvoiceData — rekapitulacja', () => {
  it('powinien zbudować rekapitulację z jednej stawki 23%', () => {
    const result = mapInvoiceData(PARSED_SINGLE_ITEM, 'invoice.xml');

    expect(result.rekapitulacja).toHaveLength(1);
    expect(result.rekapitulacja[0].stawka).toBe('23% (22%)');
    expect(result.rekapitulacja[0].netto).toBe('100,00');
    expect(result.rekapitulacja[0].vat).toBe('23,00');
    expect(result.rekapitulacja[0].brutto).toBe('123,00');
  });

  it('powinien zbudować rekapitulację z trzech stawek (23%, 8%, zw.)', () => {
    const result = mapInvoiceData(PARSED_MULTI_RATES, 'invoice.xml');

    expect(result.rekapitulacja).toHaveLength(3);
    expect(result.rekapitulacja[0].stawka).toBe('23% (22%)');
    expect(result.rekapitulacja[1].stawka).toBe('8% (7%)');
    expect(result.rekapitulacja[2].stawka).toBe('zw.');
    expect(result.rekapitulacja[2].vat).toBe('0,00');
  });

  it('powinien wyliczyć RAZEM z autorytatywnych pól (netto=ΣP_13, brutto=P_15)', () => {
    const result = mapInvoiceData(PARSED_MULTI_RATES, 'invoice.xml');

    expect(result.podsumowanie.netto).toBe('450,00');
    expect(result.podsumowanie.vat).toBe('77,00');
    expect(result.podsumowanie.brutto).toBe('527,00');
  });

  it('powinien zsumować poprawnie rekapitulację mimo ujemnych pozycji (rabaty)', () => {
    const result = mapInvoiceData(PARSED_FA3_FULL, 'invoice.xml');

    expect(result.rekapitulacja).toHaveLength(1);
    expect(result.rekapitulacja[0].netto).toBe('73,12');
    expect(result.podsumowanie.brutto).toBe('89,94');
  });
});

// --------------------------------------------------------------------------
// mapInvoiceData — sekcje FA(3): rozliczenie, płatność, stopka, podmiot3
// --------------------------------------------------------------------------

describe('mapInvoiceData — sekcje FA(3)', () => {
  it('powinien zmapować rozliczenie z odliczeniem i kwotą do zapłaty 0,00', () => {
    const result = mapInvoiceData(PARSED_FA3_FULL, 'invoice.xml');

    expect(result.rozliczenie).toBeDefined();
    expect(result.rozliczenie?.odliczenia).toHaveLength(1);
    expect(result.rozliczenie?.odliczenia[0].kwota).toBe('-89,94');
    expect(result.rozliczenie?.odliczenia[0].powod).toBe('Nadwyżka pomniejszająca kwotę faktury');
    expect(result.rozliczenie?.sumaOdliczen).toBe('-89,94');
    expect(result.rozliczenie?.doZaplaty).toBe('0,00');
    expect(result.rozliczenie?.doRozliczenia).toBeUndefined();
  });

  it('powinien zmapować nadpłatę do rozliczenia (DoRozliczenia)', () => {
    const parsed = {
      Faktura: {
        Naglowek: {},
        Podmiot1: { DaneIdentyfikacyjne: {}, Adres: {} },
        Podmiot2: { DaneIdentyfikacyjne: {}, Adres: {} },
        Fa: { P_2: 'FV/X', P_15: '100.00', Rozliczenie: { DoRozliczenia: '343.24' } },
      },
    };
    const result = mapInvoiceData(parsed, 'invoice.xml');

    expect(result.rozliczenie?.doRozliczenia).toBe('343,24');
    expect(result.rozliczenie?.doZaplaty).toBeUndefined();
  });

  it('powinien zmapować płatność: termin i numer rachunku', () => {
    const result = mapInvoiceData(PARSED_FA3_FULL, 'invoice.xml');

    expect(result.platnosc).toBeDefined();
    expect(result.platnosc?.zaplacono).toBe(false);
    expect(result.platnosc?.terminy[0].termin).toBe('15.04.2026');
    expect(result.platnosc?.rachunki[0].nrRB).toBe('62114016291748000084771506');
  });

  it('powinien zmapować formę płatności na etykietę i status zapłacono', () => {
    const parsed = {
      Faktura: {
        Naglowek: {},
        Podmiot1: { DaneIdentyfikacyjne: {}, Adres: {} },
        Podmiot2: { DaneIdentyfikacyjne: {}, Adres: {} },
        Fa: {
          P_2: 'FV/X',
          P_15: '10.00',
          Platnosc: { FormaPlatnosci: '6', Zaplacono: '1', DataZaplaty: '2026-04-10' },
        },
      },
    };
    const result = mapInvoiceData(parsed, 'invoice.xml');

    expect(result.platnosc?.forma).toBe('Przelew');
    expect(result.platnosc?.zaplacono).toBe(true);
    expect(result.platnosc?.dataZaplaty).toBe('10.04.2026');
  });

  it('powinien zmapować podmiot trzeci z etykietą roli', () => {
    const result = mapInvoiceData(PARSED_FA3_FULL, 'invoice.xml');

    expect(result.podmiotyTrzecie).toHaveLength(1);
    expect(result.podmiotyTrzecie[0].rola).toBe('Odbiorca');
    expect(result.podmiotyTrzecie[0].nazwa).toBe('Odbiorca Sp. z o.o.');
  });

  it('powinien zmapować stopkę: notę i rejestry KRS/REGON/BDO', () => {
    const result = mapInvoiceData(PARSED_FA3_FULL, 'invoice.xml');

    expect(result.stopka?.informacje).toEqual(['Uwaga! Informacja o saldzie.']);
    expect(result.stopka?.rejestry).toEqual({ krs: '0000010681', regon: '012100784', bdo: '000028832' });
  });

  it('powinien zmapować okres faktury (OkresFa) zamiast daty sprzedaży', () => {
    const parsed = {
      Faktura: {
        Naglowek: {},
        Podmiot1: { DaneIdentyfikacyjne: {}, Adres: {} },
        Podmiot2: { DaneIdentyfikacyjne: {}, Adres: {} },
        Fa: { P_2: 'FV/X', P_15: '10.00', OkresFa: { P_6_Od: '2026-04-01', P_6_Do: '2026-04-30' } },
      },
    };
    const result = mapInvoiceData(parsed, 'invoice.xml');

    expect(result.okres).toEqual({ od: '01.04.2026', do: '30.04.2026' });
  });

  it('powinien pominąć opcjonalne sekcje gdy XML ich nie zawiera (regresja FA(2))', () => {
    const parsed = {
      Faktura: {
        Naglowek: {},
        Podmiot1: { DaneIdentyfikacyjne: { NIP: '1', Nazwa: 'A' }, Adres: {} },
        Podmiot2: { DaneIdentyfikacyjne: { NIP: '2', Nazwa: 'B' }, Adres: {} },
        Fa: { P_2: 'FV/min', P_1: '2026-01-01', P_15: '10.00', FaWiersz: { P_7: 'X', P_11: '10.00', P_12: '23' } },
      },
    };
    const result = mapInvoiceData(parsed, 'invoice.xml');

    expect(result.rozliczenie).toBeUndefined();
    expect(result.platnosc).toBeUndefined();
    expect(result.stopka).toBeUndefined();
    expect(result.podmiotyTrzecie).toHaveLength(0);
    expect(result.adnotacje).toHaveLength(0);
  });

  it('powinien wykryć adnotacje aktywne (P_18A=1) i pominąć nieaktywne (P_16=2)', () => {
    const parsed = {
      Faktura: {
        Naglowek: {},
        Podmiot1: { DaneIdentyfikacyjne: {}, Adres: {} },
        Podmiot2: { DaneIdentyfikacyjne: {}, Adres: {} },
        Fa: { P_2: 'FV/X', P_15: '10.00', Adnotacje: { P_16: '2', P_18A: '1' } },
      },
    };
    const result = mapInvoiceData(parsed, 'invoice.xml');

    expect(result.adnotacje).toEqual(['Mechanizm podzielonej płatności']);
  });
});
