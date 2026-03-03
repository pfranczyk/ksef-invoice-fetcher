# KSeF Invoice Fetcher

Aplikacja CLI w TypeScript do pobierania faktur z polskiego systemu **KSeF API 2.0** i generowania ich jako PDF. Składa się z trzech niezależnych etapów: uwierzytelnianie, pobieranie faktur XML, generowanie PDF.

---

## Wymagania

- **Node.js** 20.0.0+
- **LibreOffice** 7.x+ (tylko do generowania PDF)
- **Token KSeF** — wygenerowany w portalu KSeF dla danego NIP

---

## Szybki start

```bash
# 1. Zainstaluj zależności
npm install

# 2. Skonfiguruj środowisko
cp .env.example .env
# Wypełnij .env (patrz sekcja Konfiguracja poniżej)

# 3. Test autoryzacji
npm start

# 4. Pobierz faktury (poprzedni miesiąc)
npm run fetch

# 5. Wygeneruj PDF (poprzedni miesiąc)
npm run generate-pdf
```

---

## Komendy CLI

Wszystkie komendy to `node src/index.ts` z odpowiednimi opcjami:

| Opcja | Opis |
|-------|------|
| *(brak opcji)* | Test autoryzacji — loguje do KSeF i zapisuje token JWT |
| `--df <YYYY-MM-DD>` | Data od (eksport faktur), wymaga `--dt` |
| `--df <YYYY-MM>` | Pobierz cały miesiąc, np. `--df 2026-02` |
| `--df` *(bez wartości)* | Pobierz poprzedni miesiąc kalendarzowy |
| `--dt <YYYY-MM-DD>` | Data do (eksport faktur), używana razem z `--df` |
| `-o, --output <dir>` | Katalog wyjściowy dla faktur XML |
| `--generate-pdf [YYYY-MM]` | Generuj PDF dla podanego miesiąca (domyślnie: poprzedni) |
| `--template <path>` | Ścieżka do szablonu DOCX |
| `--pdf-output <dir>` | Katalog wyjściowy dla PDF |
| `--start-day <1-31>` | Filtrowanie PDF — dzień początkowy |
| `--end-day <1-31>` | Filtrowanie PDF — dzień końcowy |

### Skrypty npm

| Skrypt | Odpowiednik | Opis |
|--------|-------------|------|
| `npm start` | `node src/index.ts` | Test autoryzacji |
| `npm run auth` | `node src/index.ts` | Test autoryzacji (alias) |
| `npm run fetch` | `node src/index.ts --df` | Pobierz faktury za poprzedni miesiąc |
| `npm run generate-pdf` | `node src/index.ts --generate-pdf` | Generuj PDF za poprzedni miesiąc |
| `npm run typecheck` | `tsc --noEmit` | Sprawdzenie typów TypeScript |
| `npm test` | `vitest run` | Uruchom testy |
| `npm run test:coverage` | `vitest run --coverage` | Testy z pokryciem kodu |

### Przykłady

```bash
# Pobierz cały styczeń 2026
node src/index.ts --df 2026-01-01 --dt 2026-01-31

# Pobierz cały miesiąc (skrócona forma)
node src/index.ts --df 2026-01

# Wygeneruj PDF dla lutego, tylko dni 1-15
node src/index.ts --generate-pdf 2026-02 --start-day 1 --end-day 15

# Wygeneruj PDF z niestandardowym szablonem
node src/index.ts --generate-pdf 2026-02 --template ./templates/Faktura.docx
```

---

## Konfiguracja (.env)

Skopiuj `.env.example` jako `.env` i dostosuj wartości. Minimalne wymagania:

```env
KSEF_ENV=DEMO          # Środowisko: DEMO | TEST | PRD
NIP=0000000000         # NIP kontekstu (10 cyfr, bez kresek)
TOKEN_PATH=./tokens/ksef.token  # Plik z tokenem KSeF
```

Pełna lista zmiennych środowiskowych z opisami — patrz dokumentacja poszczególnych etapów.

---

## Etapy

### Etap 1 — Uwierzytelnianie → [Authentication.md](./Authentication.md)

Pobiera token KSeF z pliku, szyfruje go (RSA-OAEP), wykonuje challenge-response z API KSeF i uzyskuje tokeny JWT (`accessToken` + `refreshToken`). Tokeny są cachowane w pliku i automatycznie odświeżane.

```bash
npm start   # test autoryzacji
```

### Etap 2 — Pobieranie faktur → [Invoices.md](./Invoices.md)

Inicjuje eksport paczek ZIP z KSeF API, pobiera je, deszyfruje (AES-256-CBC), rozpakowuje i zapisuje faktury XML do `output/{MM}/`.

```bash
npm run fetch                                         # poprzedni miesiąc
node src/index.ts --df 2026-01-01 --dt 2026-01-31    # wybrany zakres
```

### Etap 3 — Generowanie PDF → [PDF.md](./PDF.md)

Parsuje faktury XML, wypełnia nimi szablon DOCX i konwertuje do PDF przez LibreOffice headless.

```bash
npm run generate-pdf                    # poprzedni miesiąc
node src/index.ts --generate-pdf 2026-02 --template ./templates/Faktura.docx
```

---

## Struktura projektu

```
ksef/
├── src/
│   ├── index.ts              # Punkt wejścia (CLI)
│   ├── auth/                 # Etap 1 — uwierzytelnianie
│   ├── invoices/             # Etap 2 — pobieranie faktur
│   ├── pdf/                  # Etap 3 — generowanie PDF
│   ├── config/env.ts         # Konfiguracja z .env
│   └── utils/                # HTTP client, logger, walidator, pliki
├── output/
│   └── {MM}/                 # Faktury XML per miesiąc
│       ├── _metadata.json
│       ├── *.xml
│       └── pdf/              # Wygenerowane PDF
├── tokens/
│   └── ksef-tokens.json      # Cache tokenów JWT (auto-tworzony)
├── certs/                    # Token KSeF i klucze certyfikatów
├── templates/                # Szablony DOCX dla PDF
├── .env.example              # Wzór konfiguracji
└── doc/                     # Dokumentacja
    ├── README.md             # Ten plik
    ├── Authentication.md     # Etap 1 — szczegóły
    ├── Invoices.md           # Etap 2 — szczegóły
    └── PDF.md                # Etap 3 — szczegóły
```

---

## Środowiska KSeF

| `KSEF_ENV` | URL API |
|------------|---------|
| `DEMO` | `https://api-demo.ksef.mf.gov.pl` |
| `TEST` | `https://api-test.ksef.mf.gov.pl` |
| `PRD` | `https://api.ksef.mf.gov.pl` |

> **Uwaga:** Środowiska TEST i DEMO mogą mieć przerwy serwisowe (typowo 16:00–18:00).

---

## Bezpieczeństwo

- `TOKEN_PATH` (token KSeF) i `tokens/ksef-tokens.json` (JWT) traktuj jak hasła — **nie commituj do repozytorium**
- Pliki te są dodane do `.gitignore`
- Logger automatycznie maskuje wrażliwe dane w logach

---

## Technologie

- **TypeScript** (strict mode, Node.js native TS execution — brak kroku build)
- **Commander.js** — CLI
- **node-forge** — kryptografia RSA-OAEP
- **adm-zip** — rozpakowywanie paczek ZIP
- **docxtemplater** + **pizzip** — szablony DOCX
- **LibreOffice headless** — konwersja DOCX → PDF
- **Winston** — logger
- **Vitest** — testy (235 testów, 20 plików)
