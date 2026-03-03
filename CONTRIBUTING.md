# Contributing

## Wymagania środowiska

- Node.js 20+
- LibreOffice 7.x+
- Dostęp do KSeF

## Pierwsze kroki

```bash
git clone https://github.com/<user>/ksef-invoice-fetcher.git
cd ksef-invoice-fetcher
npm install
cp .env.example .env
# Uzupełnij .env własnymi danymi
```

## Komendy

```bash
npm test              # uruchom wszystkie testy
npm run test:watch    # tryb watch
npm run test:coverage # raport pokrycia
npx tsc --noEmit      # sprawdzenie typów (brak kroku budowania)
```

## Standardy kodu

Projekt używa TypeScript w trybie strict. Przed wysłaniem PR upewnij się że:

- `npx tsc --noEmit` nie zwraca błędów
- `npm test` — wszystkie testy przechodzą
- Importy używają rozszerzenia `.ts` (nie `.js`)
- Stałe definiowane przez `Object.freeze<T>({...})` — bez `as const`
- Typy: prefix `T` dla aliasów, prefix `I` dla interfejsów API
- JSDoc (`@param`, `@returns`, `@throws`) dla każdej eksportowanej funkcji
- Brak enumów — union types: `type TEnvironment = 'DEMO' | 'TEST' | 'PRD'`

## Zgłaszanie błędów

Otwórz issue na GitHub z opisem:

1. Środowisko (DEMO / TEST / PRD)
2. Kroki do reprodukcji
3. Oczekiwane vs rzeczywiste zachowanie
4. Logi (zamaskuj NIP i tokeny przed wklejeniem)

## Pull requesty

- Jeden PR — jeden problem lub funkcjonalność
- Opisz co i dlaczego zmieniono
- Dołącz testy dla nowych funkcji
- Upewnij się że CI przechodzi
