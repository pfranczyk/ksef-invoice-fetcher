# Etap 1 — Uwierzytelnianie (KSeF Token Auth)

Etap 1 odpowiada za uzyskanie ważnego `accessToken` JWT do wywołań KSeF API. Wynik tego etapu jest wymagany przez Etap 2 (pobieranie faktur).

---

## Jak uruchomić

```bash
npm start
# lub
node src/index.ts
```

Jeśli w cache są ważne tokeny → aplikacja ich użyje bez logowania (`Using cached session`).
Jeśli nie ma cache lub tokeny wygasły → pełny proces logowania tokenem KSeF.

---

## Konfiguracja

Zmienne środowiskowe wymagane dla Etapu 1 (plik `.env`):

| Zmienna | Domyślnie | Opis |
|---------|-----------|------|
| `KSEF_ENV` | *(wymagane)* | Środowisko: `DEMO`, `TEST`, `PRD` |
| `NIP` | *(wymagane)* | NIP kontekstu (10 cyfr, bez kresek i spacji) |
| `TOKEN_PATH` | `./tokens/ksef.token` | Ścieżka do pliku z **tokenem KSeF** |
| `KSEF_PUBLIC_KEY_PATH` | `./certs/ksef-public.pem` | Cache certyfikatu klucza publicznego KSeF. Jeśli brak lub nieaktualny — pobierany automatycznie z API |
| `TOKEN_STORAGE_PATH` | `./tokens/ksef-tokens.json` | Plik cache tokenów JWT (`accessToken`, `refreshToken`) |
| `TOKEN_REFRESH_MARGIN_MINUTES` | `5` | Margines bezpieczeństwa ważności `accessToken` (minuty). Token jest uznawany za wygasły `N` minut przed faktycznym wygaśnięciem |

Zmienne `CERT_PATH`, `CERT_KEY_PATH`, `CERT_PASSWORD` są obecne w `.env.example`, ale **nie są używane w Etapie 1** (zarezerwowane pod przyszłe rozszerzenia).

---

## Jak działa — flow uwierzytelniania

### Punkt wejścia: `src/index.ts` → `getValidAccessToken()` → `authenticate()`

#### 1. Sprawdzenie cache tokenów

Funkcja `getValidAccessToken(config)` w `src/auth/token-manager.ts`:

1. Odczytuje `TOKEN_STORAGE_PATH` (np. `tokens/ksef-tokens.json`)
2. Jeśli plik istnieje i zawiera tokeny dla **tego samego NIP i środowiska**:
   - `accessToken` ważny (z marginesem `TOKEN_REFRESH_MARGIN_MINUTES`) → **zwraca od razu**
   - `accessToken` wygasł, ale `refreshToken` ważny → **wykonuje refresh**
   - `refreshToken` wygasł → kasuje plik, przechodzi do pełnego logowania
3. Jeśli plik nie istnieje lub NIP/ENV nie pasują → kasuje plik, pełne logowanie

#### 2. Pełne logowanie tokenem KSeF (`src/auth/ksef-token-auth.ts`)

| Krok | Funkcja | Endpoint | Opis |
|------|---------|----------|------|
| 1 | `loadKsefToken()` | — | Wczytuje token KSeF z pliku `TOKEN_PATH` |
| 2 | `getPublicKey()` | `GET /v2/security/public-key-certificates` | Pobiera certyfikat klucza publicznego (lub używa cache). Wybiera certyfikat z `usage=KsefTokenEncryption`, najdalej ważny |
| 3 | `getChallenge()` | `POST /v2/auth/challenge` | Pobiera `challenge` i `timestampMs` (ważne 10 min) |
| 4 | `encryptKsefToken()` | — | Szyfruje `"{token}\|{timestampMs}"` algorytmem RSA-OAEP SHA-256, wynik w Base64 |
| 5 | `submitKsefTokenAuth()` | `POST /v2/auth/ksef-token` | Wysyła zaszyfrowany token → otrzymuje `authenticationToken` i `referenceNumber` |
| 6 | `pollAuthStatus()` | `GET /v2/auth/{referenceNumber}` | Polling co 2s (timeout 120s) do statusu `200` |
| 7 | `redeemToken()` | `POST /v2/auth/token/redeem` | Wymienia `authenticationToken` na `accessToken` + `refreshToken` |

#### 3. Zapis tokenów

`saveTokens()` zapisuje do `TOKEN_STORAGE_PATH`:

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "accessTokenExpiresAt": 1737120900000,
  "refreshTokenExpiresAt": 1737725700000,
  "savedAt": 1737120000000,
  "nip": "1234567890",
  "environment": "DEMO"
}
```

Payload JWT jest dekodowany **bez weryfikacji podpisu** — tylko do odczytu `exp`.

#### 4. Refresh tokenów

Gdy `accessToken` wygasł, ale `refreshToken` jest ważny:

```
POST /v2/auth/token/refresh
Authorization: Bearer {refreshToken}
```

Po udanym refreshu oba nowe tokeny są zapisywane do pliku.

---

## Pliki implementacji

| Plik | Rola |
|------|------|
| `src/auth/ksef-token-auth.ts` | Główny flow logowania tokenem KSeF (kroki 1–7) |
| `src/auth/public-key.ts` | Pobieranie i cache certyfikatu klucza publicznego |
| `src/auth/challenge.ts` | `POST /v2/auth/challenge` |
| `src/auth/crypto.ts` | Szyfrowanie tokena RSA-OAEP |
| `src/auth/token-manager.ts` | Cache/refresh tokenów JWT |
| `src/config/env.ts` | Konfiguracja z `.env` |
| `src/utils/http-client.ts` | HTTP z retry dla 429 (max 3 próby, wg `Retry-After`) |
| `src/utils/validator.ts` | Walidacja NIP (10 cyfr + suma kontrolna) |

---

## Typowe błędy i rozwiązania

### `NIP must be exactly 10 digits` / `Invalid NIP checksum`

NIP w `.env` musi mieć dokładnie 10 cyfr i poprawną sumę kontrolną, bez spacji i kresek:
```env
NIP=1234567890   # tak
NIP=123-456-78-90  # nie
```

### `Token file not found` / `Wymagany plik nie istnieje: TOKEN_PATH`

Brak pliku z tokenem KSeF. Token generuje się **jednorazowo** po uwierzytelnieniu XAdES w portalu KSeF. Sprawdź wartość `TOKEN_PATH` w `.env`.

### `Failed to download public key certificates`

Możliwe przyczyny:
- Brak dostępu do sieci lub blokada firewall/proxy
- Zły `KSEF_ENV` (literówka)
- Chwilowe problemy środowiska (TEST/DEMO mają okna serwisowe typowo 16:00–18:00)

### `No currently valid certificate found for usage=KsefTokenEncryption`

API zwróciło listę certyfikatów, ale żaden nie ma `usage=KsefTokenEncryption` lub żaden nie jest aktualny (`validFrom/validTo`). Skontaktuj się z pomocą KSeF.

### `KSeF token auth failed: HTTP 4xx`

Najczęściej:
- Token KSeF nie ma uprawnień do tego NIP
- Token KSeF jest unieważniony lub wygasł
- Zły klucz publiczny użyty do szyfrowania (usuń plik `KSEF_PUBLIC_KEY_PATH` i uruchom ponownie)

### Timeout w pollAuthStatus

Domyślny timeout: 120 sekund. Jeśli środowisko testowe jest przeciążone, uruchom ponownie.

### Cache tokenów nie działa — każdy run robi pełne logowanie

Sprawdź:
- Czy katalog `tokens/` ma uprawnienia do zapisu
- Czy nie zmieniasz `NIP` lub `KSEF_ENV` między uruchomieniami (cache jest kasowany przy mismatch — to zamierzone zachowanie)
- Czy `LOG_LEVEL=debug` nie pokazuje błędu przy odczycie pliku JWT

### HTTP 429 (rate limiting)

HTTP client ma automatyczny retry tylko dla 429: max 3 próby, odczekuje dokładnie tyle ile wskazuje nagłówek `Retry-After` (domyślnie 60s jeśli brak nagłówka).
