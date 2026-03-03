# KSeF Invoice Fetcher

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

Aplikacja CLI do integracji z **Krajowym Systemem e-Faktur (KSeF)** — polskim systemem elektronicznego fakturowania prowadzonym przez Ministerstwo Finansów.

Umożliwia:
- uwierzytelnianie certyfikatem do KSeF API 2.0
- pobieranie faktur (eksport zaszyfrowanych paczek, deszyfrowanie, zapis XML)
- generowanie faktur PDF z szablonu DOCX

## Wymagania

- **Node.js 20+** (natywne uruchamianie TypeScript, bez kroku kompilacji)
- **LibreOffice 7+** — wymagane tylko do generowania PDF
- Certyfikat kwalifikowany lub testowy do uwierzytelniania w KSeF

## Instalacja

```bash
git clone https://github.com/pfranczyk/ksef-invoice-fetcher.git
cd ksef-invoice-fetcher
npm install
```

Skopiuj plik konfiguracyjny i uzupełnij dane:

```bash
cp .env.example .env
```

W pliku `.env` ustaw co najmniej:
- `KSEF_ENV` — środowisko (`DEMO`, `TEST` lub `PRD`)
- `CERT_PATH`, `CERT_KEY_PATH` — ścieżki do certyfikatu
- `NIP` — NIP podmiotu
- `LIBREOFFICE_PATH` — ścieżka do LibreOffice (tylko dla PDF)

## Użycie

Aplikacja działa w trzech niezależnych trybach:

### 1. Uwierzytelnianie (test połączenia)

```bash
npm start
```

Wykonuje pełny flow uwierzytelniania: szyfrowanie tokenu RSA-OAEP, challenge-response, pobranie JWT. Tokeny są cache'owane w `tokens/ksef-tokens.json` z automatycznym odświeżaniem.

### 2. Pobieranie faktur

```bash
# Faktury za bieżący miesiąc
npm run fetch

# Faktury z podanego zakresu dat
node src/index.ts --df 2026-02-01 --dt 2026-02-28
```

Inicjuje eksport na serwerze KSeF, polluje status, pobiera zaszyfrowane paczki ZIP, deszyfruje (AES-256-CBC) i zapisuje pliki XML do `output/{miesiąc}/`.

### 3. Generowanie PDF

```bash
# PDF za bieżący miesiąc
npm run generate-pdf

# PDF z filtrem po dniach
node src/index.ts --generate-pdf 2026-02 --start-day 1 --end-day 15
```

Parsuje faktury XML, wypełnia szablon DOCX (docxtemplater/Mustache) i konwertuje do PDF przez LibreOffice headless. Wynik w `output/{miesiąc}/pdf/`.

### Sprawdzenie typów

```bash
npm run typecheck
```

## Architektura

Trzyetapowa pipeline — każdy etap jest niezależny:

```
┌─────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│  Etap 1: Auth   │     │  Etap 2: Export      │     │  Etap 3: PDF     │
│                 │     │                      │     │                  │
│ Token KSeF      │     │ JWT + zakres dat     │     │ Pliki XML        │
│ → RSA-OAEP      │────▶│ → init export        │────▶│ → parse XML      │
│ → challenge     │     │ → poll status        │     │ → szablon DOCX   │
│ → JWT           │     │ → download + decrypt │     │ → LibreOffice    │
│                 │     │ → ZIP → XML          │     │ → PDF            │
└─────────────────┘     └──────────────────────┘     └──────────────────┘
```

### Przepływ danych

```
Auth:   certyfikat → encrypt(RSA) → KSeF API → poll → JWT (access + refresh)
Export: JWT + daty → init export → poll → download parts → decrypt(AES) → ZIP → XML
PDF:    XML → parse → DOCX template → LibreOffice headless → PDF
```

## Dokumentacja

Szczegółowa dokumentacja poszczególnych etapów znajduje się w katalogu [`doc/`](doc/README.md).

## Licencja

[ISC](LICENSE) — Copyright (c) 2026 Paweł Franczyk
