# Etap 2 — Pobieranie faktur (Invoice Export)

Etap 2 pobiera faktury z KSeF API mechanizmem eksportu paczek ZIP. Wynikiem są pliki XML i plik `_metadata.json` zapisane lokalnie w `output/{MM}/`. Etap 1 (autoryzacja) jest wykonywany automatycznie przed eksportem.

---

## Użycie CLI

```bash
# Pobierz poprzedni miesiąc kalendarzowy
npm run fetch
node src/index.ts --df

# Pobierz cały miesiąc (skrócona forma)
node src/index.ts --df 2026-01

# Pobierz wybrany zakres dni (w obrębie jednego miesiąca)
node src/index.ts --df 2026-01-01 --dt 2026-01-31
node src/index.ts --df 2026-01-15 --dt 2026-01-31

# Zapisz do niestandardowego katalogu
node src/index.ts --df 2026-01 --output ./archiwum/2026/
```

### Ograniczenia zakresu dat

Obie daty muszą należeć do **tego samego miesiąca** (ograniczenie MVP v1):

```bash
✅ --df 2026-01-01 --dt 2026-01-31   # cały styczeń
✅ --df 2026-01-10 --dt 2026-01-20   # część stycznia
❌ --df 2026-01-25 --dt 2026-02-05   # łamie granicę miesiąca
```

Jeśli potrzebujesz danych z kilku miesięcy, uruchom komendę osobno dla każdego miesiąca.

---

## Konfiguracja

Zmienne środowiskowe dla Etapu 2 (plik `.env`):

| Zmienna | Domyślnie | Opis |
|---------|-----------|------|
| `KSEF_ENV` | *(wymagane)* | Środowisko: `DEMO`, `TEST`, `PRD` |
| `NIP` | *(wymagane)* | NIP nabywcy (kontekst eksportu) |
| `TOKEN_PATH` | `./tokens/ksef.token` | Token KSeF do autoryzacji |
| `OUTPUT_DIR` | `./output` | Katalog bazowy dla faktur |
| `TEMP_DIR` | `./tmp` | Katalog tymczasowy (cleanup przy SIGINT) |
| `TOKEN_STORAGE_PATH` | `./tokens/ksef-tokens.json` | Cache tokenów JWT |
| `KSEF_PUBLIC_KEY_PATH` | `./certs/ksef-public.pem` | Cache klucza publicznego KSeF |
| `EXPORT_POLL_INTERVAL_SECONDS` | `5` | Interwał sprawdzania statusu eksportu (sekundy) |
| `EXPORT_STATUS_MAX_WAIT_MINUTES` | `0` | Maksymalny czas oczekiwania na eksport (minuty, `0` = bez limitu) |

---

## Jak działa — 6 kroków eksportu

Implementacja w `src/invoices/`, orkiestracja w `export-service.ts`.

### Krok 1 — Generowanie parametrów szyfrowania (`export-crypto.ts`)

Przed każdym eksportem generowane są jednorazowe klucze:
- **Klucz AES-256** (32 bajty) — do deszyfrowania pobranej paczki
- **IV** (16 bajtów) — wektor inicjalizacyjny dla AES-256-CBC
- **Zaszyfrowany klucz AES** — klucz AES zaszyfrowany kluczem publicznym KSeF (RSA-OAEP SHA-256), wysyłany do API

### Krok 2 — Inicjalizacja eksportu (`export-api.ts`)

```
POST /v2/invoices/exports
Authorization: Bearer {accessToken}
```

Parametry eksportu (hardcoded, MVP v1):
- `subjectType: "Subject2"` — faktury **dla użytkownika** (jako nabywcy)
- `dateType: "Invoicing"` — data wystawienia faktury

API zwraca `referenceNumber` do dalszego monitorowania.

### Krok 3 — Polling statusu (`export-api.ts`)

```
GET /v2/invoices/exports/{referenceNumber}
```

Odpytywanie co `EXPORT_POLL_INTERVAL_SECONDS` sekund do statusu `200`:

| Kod | Znaczenie | Akcja |
|-----|-----------|-------|
| `100` | W toku | Czekaj |
| `200` | Gotowe | Pobierz paczki |
| `200` + `package: null` | Brak faktur w zakresie | Zakończ bez błędu |
| `200` + `isTruncated: true` | Limit 10 000 faktur przekroczony | **Ostrzeżenie** — paczka jest niepełna, pobierz mniejszy zakres |
| `210` | Wygasłe | Błąd — wystartuj nowy eksport |
| `415` | Błąd deszyfrowania klucza | Błąd krytyczny |
| `420` | Zakres dat poza dostępnymi | Błąd krytyczny |
| `500` | Błąd systemowy KSeF | Błąd krytyczny |
| `550` | Anulowane | Błąd krytyczny |

### Krok 4 — Pobieranie paczek (`export-download.ts`)

API zwraca listę URL-i do pobrania części paczki (każda część ma `ordinalNumber`, `encryptedPartHash`, `expirationDate`). Aplikacja:

1. Sortuje części wg `ordinalNumber`
2. Pobiera każdą część HTTP (bez nagłówka Authorization — link jest podpisany)
3. Weryfikuje SHA-256 z `encryptedPartHash`
4. Deszyfruje część (AES-256-CBC) i trzyma w pamięci

Retry bez limitu dla błędów sieciowych (ECONNRESET, ETIMEDOUT, ENOTFOUND) — odczekuje 20s przed ponowną próbą.

### Krok 5 — Scalanie i walidacja ZIP (`export-zip.ts`)

Odszyfrowane części (tablice `Buffer`) są scalane w kolejności `ordinalNumber`, a następnie:
- Weryfikowany jest całkowity rozmiar vs suma `partSize`
- Sprawdzane są magic bytes ZIP (`50 4B 03 04`)

Całość przetwarzana jest **w pamięci** — żadne pliki tymczasowe nie trafiają na dysk.

### Krok 6 — Zapis faktur (`export-storage.ts`)

ZIP jest rozpakowywany i zawartość zapisywana do `{OUTPUT_DIR}/{MM}/`:

- Pliki XML — zawsze nadpisywane (API jest źródłem prawdy)
- `_metadata.json` — metadane wszystkich faktur w paczce

---

## Struktura plików wyjściowych

```
output/
└── 01/                         # Miesiąc z --df (styczeń = 01)
    ├── _metadata.json           # Metadane wszystkich faktur
    ├── 20260115-EH-ABC123-EE.xml
    └── 20260120-EH-DEF456-FF.xml
```

### Format nazwy pliku XML

Nazwa pliku to numer KSeF: `YYYYMMDD-KK-XXXXXXXXXX-YYYYYYYYYY-ZZ.xml`

- `YYYYMMDD` — data wystawienia
- `KK` — kod środowiska: `EH`=TEST, `ED`=DEMO, `EP`=PRD
- `XXXXXXXXXX` — hex ID sprzedawcy
- `YYYYYYYYYY` — hex ID faktury
- `ZZ` — suma kontrolna

### Format `_metadata.json`

```json
{
  "invoices": [
    {
      "ksefNumber": "20260115-EH-ABC123-EE",
      "invoiceNumber": "FV/2026/001",
      "issueDate": "2026-01-15",
      "invoicingDate": "2026-01-15T10:30:00Z",
      "seller": { "nip": "1111111111", "name": "Firma Sprzedawca Sp. z o.o." },
      "buyer": {
        "identifier": { "type": "Nip", "value": "0000000000" },
        "name": "Firma Nabywca Sp. z o.o."
      },
      "grossAmount": 1230.00,
      "netAmount": 1000.00,
      "vatAmount": 230.00,
      "currency": "PLN"
    }
  ]
}
```

Plik można użyć do szybkiego przeglądu faktur bez otwierania XML, importu do systemów księgowych lub generowania raportów.

---

## Architektura modułów (`src/invoices/`)

| Plik | Odpowiedzialność |
|------|-----------------|
| `export-service.ts` | Orkiestracja — łączy wszystkie moduły w pipeline |
| `export-api.ts` | Komunikacja z API KSeF (init eksport, polling statusu) |
| `export-crypto.ts` | Generowanie parametrów szyfrowania AES/RSA |
| `export-download.ts` | Pobieranie i deszyfrowanie części paczek |
| `export-zip.ts` | Scalanie, walidacja ZIP |
| `export-storage.ts` | Zapis faktur XML i metadanych na dysk |

---

## Limity API KSeF

| Endpoint | req/s | req/min | req/h |
|----------|-------|---------|-------|
| `POST /invoices/exports` | 4 | 8 | 20 |
| `GET /invoices/exports/{id}` | 10 | 60 | 600 |

HTTP client obsługuje 429 automatycznie — czeka wg `Retry-After` (max 3 próby).

---

## Typowe błędy i rozwiązania

### `Date range cannot cross month boundaries`

Zakres dat obejmuje więcej niż jeden miesiąc. Uruchom osobno dla każdego miesiąca:

```bash
node src/index.ts --df 2026-01-25 --dt 2026-01-31
node src/index.ts --df 2026-02-01 --dt 2026-02-05
```

### `Invalid date format. Use YYYY-MM-DD`

Format daty jest nieprawidłowy. Wymagany: `YYYY-MM-DD` (ze zerami wiodącymi).

### Brak faktur — `Brak faktur w podanym zakresie dat`

To nie błąd — w podanym okresie po prostu nie ma faktur wystawionych dla tego NIP.

### Ostrzeżenie `⚠ Dane mogą być niepełne (eksport obcięty)`

Eksport zwrócił `isTruncated: true` — w podanym zakresie jest więcej niż 10 000 faktur (limit API). Paczka zawiera tylko pierwsze 10 000. Podziel zakres na mniejsze okresy:

```bash
node src/index.ts --df 2026-01-01 --dt 2026-01-15
node src/index.ts --df 2026-01-16 --dt 2026-01-31
```

### `Hash validation failed for part X`

Pobrana część paczki jest uszkodzona. Aplikacja ponawia automatycznie — wystarczy poczekać. Jeśli problem się powtarza, może być tymczasowy problem po stronie KSeF.

### `Invalid ZIP format after decryption`

Deszyfrowanie powiodło się, ale wynik nie jest poprawnym ZIP-em. Najczęściej: stary lub błędny klucz publiczny w cache. Usuń plik `KSEF_PUBLIC_KEY_PATH` i uruchom ponownie.

### `EACCES permission denied` przy zapisie faktur

Sprawdź uprawnienia do katalogu `OUTPUT_DIR`. Możesz też podać inny katalog:
```bash
node src/index.ts --df 2026-01 --output ./inna-lokalizacja/
```

### Linki wygasły (`HTTP 410 Gone`)

Linki do pobrania paczek są ważne przez ograniczony czas (1-2h). Uruchom ponownie — aplikacja wystartuje nowy eksport z nowymi linkami.

### Nie uruchamiaj wielu instancji jednocześnie

Równoległe uruchomienia mogą prowadzić do przekroczenia limitów API (HTTP 429). Odczekaj co najmniej 15 minut między kolejnymi eksportami.
