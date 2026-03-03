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
    Naglowek: { DataWytworzeniaFa: '2026-01-15' },
    Podmiot1: {
      DaneIdentyfikacyjne: { NIP: '1111111111', Nazwa: 'ACME Systemy Sp. z o.o.' },
      Adres: { AdresL1: 'ul. Testowa 1', AdresL2: '00-001 Warszawa', KodKraju: 'PL' },
    },
    Podmiot2: {
      DaneIdentyfikacyjne: { NIP: '2222222222', Nazwa: 'Nabywca Testowy Sp. z o.o.' },
      Adres: { AdresL1: 'ul. Nabywcowa 5', KodKraju: 'PL' },
    },
    Fa: {
      P_2: 'FV/2026/001',
      P_1: '2026-01-15',
      KodWaluty: 'PLN',
      P_13_1: '100.00',
      P_14_1: '23.00',
      P_15: '123.00',
      FaWiersz: {
        // xml2js zwraca obiekt (nie tablicę) gdy jest jedna pozycja
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

const PARSED_MULTI_ITEMS = {
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
      P_14_1: '51.00',
      P_15: '351.00',
      FaWiersz: [
        // xml2js zwraca tablicę gdy jest wiele pozycji
        {
          NrWierszaFa: '1',
          P_7: 'Pozycja pierwsza',
          P_8A: 'szt',
          P_8B: '2',
          P_9A: '50.00',
          P_11: '100.00',
          P_12: '23',
        },
        { NrWierszaFa: '2', P_7: 'Pozycja druga', P_8A: 'kg', P_8B: '5', P_9A: '20.00', P_11: '100.00', P_12: '8' },
        { NrWierszaFa: '3', P_7: 'Pozycja trzecia', P_8A: 'h', P_8B: '10', P_9A: '10.00', P_11: '100.00', P_12: '5' },
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
      FaWiersz: {
        // Tylko cena brutto — brak P_11, jest P_11A
        P_7: 'Produkt z ceną brutto',
        P_8A: 'szt',
        P_8B: '1',
        P_11A: '123.00', // brutto
        P_12: '23', // 23% VAT
      },
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
// mapInvoiceData — mapowanie danych
// --------------------------------------------------------------------------

describe('mapInvoiceData', () => {
  it('powinien zmapować NIPy, nazwy i adresy sprzedawcy i nabywcy', () => {
    const result = mapInvoiceData(PARSED_SINGLE_ITEM, 'FV_2026_001.xml');

    expect(result.sprzedawcaNIP).toBe('1111111111');
    expect(result.sprzedawcaNazwa).toBe('ACME Systemy Sp. z o.o.');
    expect(result.sprzedawcaAdres).toBe('ul. Testowa 1, 00-001 Warszawa, PL');
    expect(result.nabywcaNIP).toBe('2222222222');
    expect(result.nabywcaNazwa).toBe('Nabywca Testowy Sp. z o.o.');
    expect(result.nabywcaAdres).toBe('ul. Nabywcowa 5, PL');
  });

  it('powinien zmapować nagłówek faktury i numer KSeF z nazwy pliku', () => {
    const result = mapInvoiceData(PARSED_SINGLE_ITEM, 'KSEF-12345678901234567890.xml');

    expect(result.numerFaktury).toBe('FV/2026/001');
    expect(result.numerKSeF).toBe('KSEF-12345678901234567890');
    expect(result.waluta).toBe('PLN');
  });

  it('powinien sformatować daty wystawienia i sprzedaży z ISO na DD.MM.YYYY', () => {
    const result = mapInvoiceData(PARSED_SINGLE_ITEM, 'invoice.xml');

    expect(result.dataWystawienia).toBe('15.01.2026');
    expect(result.dataSprzedazy).toBe('15.01.2026');
  });

  it('powinien zwrócić pusty string gdy data jest undefined', () => {
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
    expect(result.dataSprzedazy).toBe('');
  });

  it('powinien zmapować kwoty z separatorem dziesiętnym pl-PL', () => {
    const result = mapInvoiceData(PARSED_SINGLE_ITEM, 'invoice.xml');

    expect(result.wartoscNetto).toBe('100,00');
    expect(result.kwotaVAT).toBe('23,00');
    expect(result.wartoscBrutto).toBe('123,00');
  });

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

  it('powinien zmapować trzy pozycje faktury z różnymi stawkami VAT', () => {
    const result = mapInvoiceData(PARSED_MULTI_ITEMS, 'invoice.xml');

    expect(result.pozycje).toHaveLength(3);
    expect(result.pozycje[0].stawkaVAT).toBe('23%');
    expect(result.pozycje[1].stawkaVAT).toBe('8%');
    expect(result.pozycje[2].stawkaVAT).toBe('5%');
    expect(result.waluta).toBe('EUR');
  });

  it('powinien zwrócić pustą tablicę pozycji gdy FaWiersz jest undefined', () => {
    const parsed = {
      Faktura: {
        Naglowek: {},
        Podmiot1: { DaneIdentyfikacyjne: {}, Adres: {} },
        Podmiot2: { DaneIdentyfikacyjne: {}, Adres: {} },
        Fa: { P_2: 'FV/001' }, // brak FaWiersz
      },
    };
    const result = mapInvoiceData(parsed, 'invoice.xml');

    expect(result.pozycje).toHaveLength(0);
  });

  it('powinien obliczyć cenę netto z brutto gdy brak P_11 (tylko P_11A)', () => {
    const result = mapInvoiceData(PARSED_GROSS_ONLY, 'invoice.xml');

    expect(result.pozycje).toHaveLength(1);
    // brutto=123, VAT=23% → netto = 123 / 1.23 ≈ 100
    const nettoNum = parseFloat(result.pozycje[0].wartoscNetto.replace(',', '.'));
    expect(nettoNum).toBeCloseTo(100, 1);
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
