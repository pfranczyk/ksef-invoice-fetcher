# Etap 3 — Generowanie PDF

Etap 3 generuje pliki PDF z faktur XML pobranych przez Etap 2. Pipeline: XML → parser → dane JSON → szablon DOCX → LibreOffice headless → PDF.

Wymagana jest uprzednia realizacja Etapu 2 (`output/{MM}/*.xml` i `output/{MM}/_metadata.json`).

---

## Wymagania systemowe

**LibreOffice 7.x+** (wymagany do konwersji DOCX → PDF):

| System | Instalacja | Typowa ścieżka |
|--------|-----------|----------------|
| Windows | Pobierz z libreoffice.org | `C:\Program Files\LibreOffice\program\soffice.exe` |
| Linux | `sudo apt-get install libreoffice-writer` | `/usr/bin/soffice` |
| macOS | `brew install --cask libreoffice` | `/Applications/LibreOffice.app/Contents/MacOS/soffice` |

LibreOffice uruchamiany jest w trybie **headless** (bez GUI) — nie musi być otwarty.

---

## Użycie CLI

```bash
# Wygeneruj PDF dla poprzedniego miesiąca
npm run generate-pdf
node src/index.ts --generate-pdf

# Wygeneruj PDF dla konkretnego miesiąca
node src/index.ts --generate-pdf 2026-02

# Z własnym szablonem DOCX
node src/index.ts --generate-pdf 2026-02 --template ./templates/Faktura.docx

# Filtruj według dni (np. tylko faktury z dni 1-15)
node src/index.ts --generate-pdf 2026-02 --start-day 1 --end-day 15

# Regeneruj tylko jedną fakturę (np. z dnia 15)
node src/index.ts --generate-pdf 2026-02 --start-day 15 --end-day 15

# Zapisz PDF w niestandardowym katalogu
node src/index.ts --generate-pdf 2026-02 --pdf-output ./faktury-klientow/
```

---

## Konfiguracja

| Zmienna | Domyślnie | Opis |
|---------|-----------|------|
| `LIBREOFFICE_PATH` | *(wymagane)* | Ścieżka do pliku `soffice` / `soffice.exe` |
| `TEMPLATE_DOCX` | *(wymagane\*)* | Ścieżka do szablonu DOCX |
| `OUTPUT_DIR` | `./output` | Katalog bazowy z fakturami XML (z Etapu 2) |

\* Wymagane jeśli nie podano `--template` w CLI.

**Weryfikacja LibreOffice:**
```bash
# Windows
"C:\Program Files\LibreOffice\program\soffice.exe" --version

# Linux/macOS
/usr/bin/soffice --version
```

---

## Szablon DOCX

Szablon to plik `.docx` ze zmiennymi w składni `{nazwaZmiennej}` (biblioteka docxtemplater).

### Zmienne dostępne w szablonie

#### Nagłówek faktury

| Zmienna | Źródło XML | Przykład |
|---------|-----------|---------|
| `{numerFaktury}` | `Fa.P_2` | `FV/2026/02/001` |
| `{numerKSeF}` | Nazwa pliku (bez .xml) | `20260203-EH-ABC123-EE` |
| `{dataWystawienia}` | `Naglowek.DataWytworzeniaFa` | `04.02.2026` |
| `{dataSprzedazy}` | `Fa.P_1` | `03.02.2026` |

#### Sprzedawca i nabywca

| Zmienna | Opis |
|---------|------|
| `{sprzedawcaNazwa}` | Nazwa sprzedawcy |
| `{sprzedawcaNIP}` | NIP sprzedawcy |
| `{sprzedawcaAdres}` | Adres: `AdresL1, AdresL2, KodKraju` |
| `{nabywcaNazwa}` | Nazwa nabywcy |
| `{nabywcaNIP}` | NIP nabywcy |
| `{nabywcaAdres}` | Adres nabywcy |

#### Podsumowanie

| Zmienna | Opis | Format |
|---------|------|--------|
| `{waluta}` | Kod waluty | `PLN` |
| `{wartoscNetto}` | Wartość netto | `1 234,56` |
| `{kwotaVAT}` | Kwota VAT | `283,95` |
| `{wartoscBrutto}` | Wartość brutto | `1 518,51` |

#### Pozycje faktury (pętla)

```
{#pozycje}
  {lp}           - Lp. pozycji
  {nazwa}        - Nazwa towaru/usługi
  {ilosc}        - Ilość
  {jednostka}    - Jednostka miary (np. szt, godz)
  {cenaNetto}    - Cena netto jednostkowa
  {wartoscNetto} - Wartość netto pozycji
  {stawkaVAT}    - Stawka VAT (np. 23%)
  {kwotaVAT}     - Kwota VAT pozycji
{/pozycje}
```

### Formatowanie danych

- **Daty**: ISO 8601 → format polski `DD.MM.YYYY`
- **Kwoty**: separator tysięcy = spacja, separator dziesiętny = przecinek (`1 234,56`)
- **Puste pola**: zastępowane pustym stringiem — bez błędu (dzięki `nullGetter`)

### Zasady składni szablonu

```
✅ {numerFaktury}         - pojedyncze nawiasy klamrowe
✅ {#pozycje}...{/pozycje} - pętla
❌ {{numerFaktury}}        - podwójne nawiasy (błąd)
❌ {numer faktury}         - spacja w nazwie (błąd)
```

### Minimalny przykład szablonu

```
FAKTURA VAT {numerFaktury}
Data wystawienia: {dataWystawienia}

SPRZEDAWCA:            NABYWCA:
{sprzedawcaNazwa}      {nabywcaNazwa}
NIP: {sprzedawcaNIP}   NIP: {nabywcaNIP}

| Lp | Nazwa | Ilość | J.m. | Cena netto | Wartość netto | VAT | Kwota VAT |
{#pozycje}
| {lp} | {nazwa} | {ilosc} | {jednostka} | {cenaNetto} | {wartoscNetto} | {stawkaVAT} | {kwotaVAT} |
{/pozycje}

Wartość netto: {wartoscNetto} {waluta}
Kwota VAT:     {kwotaVAT} {waluta}
Do zapłaty:    {wartoscBrutto} {waluta}
```

---

## Jak działa — pipeline

```
output/{MM}/_metadata.json   ←  lista faktur do przetworzenia
output/{MM}/*.xml            ←  faktury XML

Dla każdej faktury:
  1. parseInvoiceXml()    xml-parser.ts     XML → obiekt JS
  2. mapInvoiceData()     xml-parser.ts     obiekt JS → płaskie dane JSON
  3. processTemplate()    template-processor.ts  dane JSON + DOCX → wypełniony DOCX
  4. convertDocxToPdf()   docx-to-pdf.ts    DOCX → PDF (LibreOffice CLI)
  5. usunięcie pliku tymczasowego DOCX

output/{MM}/pdf/*.pdf    ←  wyniki
```

Przetwarzanie jest **sekwencyjne** (jedna faktura naraz). Nie są tworzone żadne pliki tymczasowe na dysku poza katalogiem `.temp-pdf/` (usuwany automatycznie po zakończeniu).

### Czas przetwarzania

| Operacja | Czas |
|----------|------|
| Parsowanie XML | < 100ms |
| Wypełnienie szablonu DOCX | < 200ms |
| Konwersja DOCX → PDF (LibreOffice) | ~1.5–2s |
| **Razem na fakturę** | **~2s** |

Dla 25 faktur: ~50s. Dla 100 faktur: ~3 min.

Aby przyspieszyć przy dużej liczbie faktur, uruchom dwa terminale równolegle:
```bash
# Terminal 1
node src/index.ts --generate-pdf 2026-01 --start-day 1 --end-day 15 &

# Terminal 2
node src/index.ts --generate-pdf 2026-01 --start-day 16 --end-day 31 &
```

---

## Struktura plików

```
output/02/
├── _metadata.json           # Z Etapu 2
├── 20260203-EH-ABC123-EE.xml
├── 20260203-EH-DEF456-FF.xml
├── .temp-pdf/               # Pliki tymczasowe DOCX (auto-usuwane)
└── pdf/                     # Wyniki Etapu 3
    ├── 20260203-EH-ABC123-EE.pdf
    └── 20260203-EH-DEF456-FF.pdf
```

---

## Architektura modułów (`src/pdf/`)

| Plik | Odpowiedzialność |
|------|-----------------|
| `pdf-generator.ts` | Orkiestracja — walidacja, katalogi, pętla po fakturach, statystyki |
| `xml-parser.ts` | Parsowanie XML i mapowanie na dane szablonu |
| `template-processor.ts` | Wypełnianie szablonu DOCX danymi (docxtemplater) |
| `docx-to-pdf.ts` | Konwersja DOCX → PDF przez LibreOffice CLI |

### Obsługa błędów

**Błędy krytyczne** (przerywają cały proces):
- Brak szablonu DOCX lub nieprawidłowa struktura
- Brak katalogu `output/{MM}/` (nie uruchomiono Etapu 2)
- Brak pliku `_metadata.json`
- Brak lub nieprawidłowa ścieżka LibreOffice

**Błędy niekrytyczne** (faktura pomijana, proces kontynuuje):
- Brak pliku XML faktury → `skipped`
- Błąd parsowania XML → `failed`
- Błąd renderowania szablonu → `failed`
- Błąd konwersji PDF → `failed`

### Raport końcowy

```
============================================================
GENEROWANIE PDF ZAKOŃCZONE
Łącznie faktur: 25
Wygenerowano poprawnie: 23
Nieudane: 1
Pominięte: 1
Czas trwania: 47.32s
Lokalizacja plików PDF: output/02/pdf
============================================================
```

Kod wyjścia: `0` jeśli wszystkie udane, `1` jeśli była choć jedna nieudana.

---

## Typowe błędy i rozwiązania

### `Ścieżka do LibreOffice nie jest skonfigurowana (LIBREOFFICE_PATH)`

Dodaj do `.env`:
```env
# Windows
LIBREOFFICE_PATH=C:\Program Files\LibreOffice\program\soffice.exe
# Linux
LIBREOFFICE_PATH=/usr/bin/soffice
# macOS
LIBREOFFICE_PATH=/Applications/LibreOffice.app/Contents/MacOS/soffice
```

### `Wymagana jest ścieżka do szablonu`

Podaj szablon przez CLI lub `.env`:
```bash
node src/index.ts --generate-pdf 2026-02 --template ./templates/Faktura.docx
# lub w .env:
TEMPLATE_DOCX=./templates/Faktura.docx
```

### `Nie znaleziono katalogu faktur: output/02`

Faktury nie zostały jeszcze pobrane. Uruchom Etap 2:
```bash
node src/index.ts --df 2026-02-01 --dt 2026-02-28
```

### `Nieprawidłowy lub uszkodzony plik szablonu`

Plik nie jest poprawnym DOCX (np. to stary format `.doc`). Otwórz w Word/LibreOffice i zapisz jako `.docx`.

### Zmienne `{nazwaZmiennej}` widoczne w PDF zamiast danych

Najczęstsze przyczyny:
- Błędna składnia: użyto `{{zmienna}}` zamiast `{zmienna}`
- Literówka w nazwie zmiennej
- Dane nie istnieją w XML faktury (pole zostanie puste, nie rzuci błędu)

Diagnoza:
```bash
LOG_LEVEL=debug node src/index.ts --generate-pdf 2026-02 --start-day 1 --end-day 1
```

### Pozycje faktury nie wyświetlają się (`{#pozycje}` puste)

Sprawdź czy pętla jest zamknięta:
```
{#pozycje}
...
{/pozycje}   ← musi być!
```

Sprawdź czy XML zawiera sekcje `<FaWiersz>` (faktury bez pozycji to rzadkość, ale możliwe).

### PDF wygląda inaczej niż szablon DOCX

Problem leży w konwersji LibreOffice. Sprawdź:
- Czy czcionki są zainstalowane w systemie (LibreOffice renderuje czcionki z systemu operacyjnego)
- Użyj standardowych czcionek: Arial, Calibri, Times New Roman
- Przetestuj ręcznie: `soffice --headless --convert-to pdf --outdir "." "test.docx"`

### Proces się zawiesza / nie kończy

LibreOffice może się zawieszać przy uszkodzonych plikach lub braku pamięci.

```bash
# Zabij proces ręcznie
# Windows
taskkill /F /IM soffice.exe
# Linux/macOS
pkill soffice
```

Podziel na mniejsze partie (`--start-day` / `--end-day`) i uruchom ponownie.

### Linux — LibreOffice wymaga X11 / serwer bez GUI

LibreOffice headless nie wymaga GUI. Jeśli pojawia się błąd związany z X11:
```bash
sudo apt-get install xvfb
xvfb-run node src/index.ts --generate-pdf 2026-02
```

### macOS — `LibreOffice nie może być otwarty (niezweryfikowany wydawca)`

System Preferences → Security & Privacy → kliknij "Open Anyway" przy LibreOffice.
