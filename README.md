# @logrox/ksef

[![npm version](https://img.shields.io/npm/v/@logrox/ksef?logo=npm)](https://www.npmjs.com/package/@logrox/ksef)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

CLI do integracji z **Krajowym Systemem e-Faktur (KSeF)** — polskim systemem
elektronicznego fakturowania prowadzonym przez Ministerstwo Finansów.

Aplikacja wykonuje trzy zadania:

- **uwierzytelnia** w KSeF API 2.0 tokenem KSeF (RSA-OAEP, JWT z auto-refresh),
- **pobiera faktury** z wybranego zakresu dat,
- **generuje PDF** dla każdej faktury.

## Wymagania

- **Node.js 24+**
- **Token KSeF** wygenerowany w portalu KSeF dla danego NIP

## Instalacja

```bash
npm install -g @logrox/ksef
ksef --version
```

Po instalacji w systemie dostępna jest komenda `ksef`. Konfiguracja jest
**per katalog roboczy** (model multi-klient) — każdy klient w osobnym
katalogu z własnym `.ksef/`.

## Szybki start

```bash
# 1. Utwórz katalog klienta i wejdź do niego
mkdir klient-x && cd klient-x

# 2. Zainicjalizuj katalog klienta (utworzy .ksef/ z konfiguracją)
ksef init 0000000000 DEMO    # NIP + środowisko (DEMO|TEST|PRD, domyślnie PRD)

# 3. Wklej token KSeF do .ksef/ksef.token (token wygenerowany w portalu KSeF
#    dla wybranego środowiska, sam string bez znaków białych)

# 4. Sprawdź autoryzację
ksef login

# 5. Pobierz faktury (np. luty 2026)
ksef fetch --df 2026-02

# 6. Wygeneruj PDF
ksef pdf 2026-02
```

Faktury XML lądują w `./xml/{MM}/` (np. `./xml/02/`), wygenerowane PDF
w `./pdf/{MM}/`. Tokeny JWT są cache'owane w `.ksef/tokens.json`
i automatycznie odświeżane przed wygaśnięciem.

## Konfiguracja

`ksef init <nip> [env]` tworzy katalog `.ksef/` z plikiem `config.json`,
pustym plikiem tokenu i krótkim `README.txt` z instrukcją. Struktura:

```
.ksef/
├── config.json       konfiguracja klienta (NIP, środowisko, parametry)
├── ksef.token        token KSeF wklejony z portalu KSeF
├── public-key.pem    cache klucza publicznego KSeF (auto-pobierany)
├── tokens.json       cache JWT — accessToken/refreshToken (auto-tworzony)
└── tmp/              pliki tymczasowe
```

### Pola `config.json`

| Pole | Wymagane | Domyślnie | Opis |
|---|---|---|---|
| `nip` | tak | — | 10-cyfrowy NIP klienta (bez kresek) |
| `environment` | tak | — | `DEMO` / `TEST` / `PRD` |
| `tokenRefreshMarginMinutes` | nie | `5` | Z jakim wyprzedzeniem (min.) odświeżać JWT (0-60) |
| `exportPollIntervalSeconds` | nie | `5` | Częstotliwość pollingu statusu eksportu (1-300) |
| `exportStatusMaxWaitMinutes` | nie | `0` | Timeout eksportu w minutach (`0` = bez limitu) |

Pola opcjonalne wygodnie edytuje się komendami `ksef margin <minuty>` oraz
`ksef interval <sekundy>` — bez ręcznej edycji JSON-a.

### Środowiska KSeF

| `environment` | URL API |
|---|---|
| `DEMO` | `https://api-demo.ksef.mf.gov.pl` |
| `TEST` | `https://api-test.ksef.mf.gov.pl` |
| `PRD` | `https://api.ksef.mf.gov.pl` |

> Środowiska DEMO i TEST mogą mieć przerwy serwisowe (typowo 16:00–18:00).

## Komendy

### `ksef init <nip> [env]`

```bash
ksef init 0000000000          # NIP + środowisko PRD (domyślne)
ksef init 0000000000 DEMO     # NIP + środowisko DEMO
```

Tworzy `.ksef/config.json` z podanym NIP-em i środowiskiem, pusty
`ksef.token` (do uzupełnienia) oraz `README.txt` z instrukcją.
Idempotentne — istniejący `ksef.token` nie jest nadpisywany.

### `ksef login`

```bash
ksef login
```

Sprawdza autoryzację: szyfruje token KSeF kluczem publicznym KSeF, wykonuje
challenge-response z API, pobiera parę JWT (access + refresh). Tokeny są
zapisywane do `.ksef/tokens.json` i wykorzystywane przez kolejne komendy
bez konieczności ponownego logowania.

### `ksef fetch --df <data> [--dt <data>]`

```bash
ksef fetch --df 2026-02                      # cały miesiąc (format YYYY-MM)
ksef fetch --df 2026-02-01 --dt 2026-02-28   # dowolny zakres dat
```

| Opcja | Opis |
|---|---|
| `--df <data>` | **Wymagane.** Format `YYYY-MM` (cały miesiąc) lub `YYYY-MM-DD` (wymaga `--dt`) |
| `--dt <data>` | Data końcowa (`YYYY-MM-DD`), używana razem z `--df` w formacie dziennym |

Inicjuje eksport w KSeF, polluje status, pobiera zaszyfrowane paczki ZIP,
deszyfruje (AES-256-CBC) i zapisuje faktury XML do `./xml/{MM}/`.

### `ksef pdf [miesiąc]`

```bash
ksef pdf 2026-02                              # PDF dla wskazanego miesiąca
ksef pdf 2026-02 --start-day 1 --end-day 15   # tylko faktury z dni 1–15
ksef pdf                                      # bez argumentu → poprzedni miesiąc
```

| Argument / Opcja | Opis |
|---|---|
| `[miesiąc]` | Miesiąc w formacie `YYYY-MM`; gdy pominięty — poprzedni miesiąc kalendarzowy |
| `--start-day <dzień>` | Filtruje faktury od podanego dnia miesiąca (1-31) |
| `--end-day <dzień>` | Filtruje faktury do podanego dnia miesiąca (1-31) |

Parsuje faktury XML (pełny model FA(3) wg schematu `schemat_FA(3)_v1-0E.xsd`)
i renderuje PDF przez pdfmake. Wbudowane czcionki Roboto, bez procesów
zewnętrznych, bez plików tymczasowych. Wyniki w `./pdf/{MM}/`.

### `ksef margin [minuty]`

```bash
ksef margin           # wypisuje aktualną wartość
ksef margin 10        # ustawia margines odświeżania JWT na 10 minut (0-60)
```

Wygodny edytor pola `tokenRefreshMarginMinutes` w `.ksef/config.json`.

### `ksef interval [sekundy]`

```bash
ksef interval         # wypisuje aktualną wartość
ksef interval 10      # ustawia interwał pollingu eksportu na 10 sekund (1-300)
```

Wygodny edytor pola `exportPollIntervalSeconds` w `.ksef/config.json`.

### `ksef help [komenda]`

```bash
ksef help             # pomoc globalna
ksef help fetch       # pomoc dla wybranej komendy
```

### Opcje globalne

| Opcja | Opis |
|---|---|
| `-v, --verbose` | Szczegółowe logi (poziom debug) |
| `-V, --version` | Wersja paczki |
| `-h, --help` | Pomoc dla komendy |

Przykład: `ksef -v fetch --df 2026-01`

## Bezpieczeństwo

- **Cały katalog `.ksef/` traktuj jak hasła — nie commituj do repozytorium.**
  Zawiera token KSeF (`ksef.token`) i cache JWT (`tokens.json`).
- Logger automatycznie maskuje wrażliwe wartości (tokeny, klucze) w wypisach
  konsoli.
- JWT są krótkotrwałe — wygasają po stronie KSeF; aplikacja odświeża je
  refresh tokenem z `tokenRefreshMarginMinutes` zapasu przed wygaśnięciem.

## Rozwój

Kod źródłowy: [github.com/pfranczyk/ksef-invoice-fetcher](https://github.com/pfranczyk/ksef-invoice-fetcher).
Zgłaszanie błędów: [GitHub Issues](https://github.com/pfranczyk/ksef-invoice-fetcher/issues).

## Licencja

[ISC](LICENSE) — Copyright (c) 2026 Paweł Franczyk
