# Contributing

## Wymagania środowiska

- Node.js 24+
- Dostęp do KSeF

## Pierwsze kroki

```bash
git clone https://github.com/pfranczyk/ksef-invoice-fetcher.git
cd ksef-invoice-fetcher
npm install
npm run build              # tsup → dist/index.js
```

Do uruchomienia CLI na własnym kliencie testowym wejdź do osobnego katalogu
(np. `D:\temp\ksef-test`) i wykonaj:

```bash
node /ścieżka/do/repo/dist/index.js init 0000000000 DEMO
# Następnie wklej token KSeF do .ksef/ksef.token i uruchom:
node /ścieżka/do/repo/dist/index.js login
```

## Komendy

```bash
npm test              # uruchom wszystkie testy
npm run test:watch    # tryb watch
npm run test:coverage # raport pokrycia
npm run typecheck     # tsc --noEmit (jedyna bramka typów — esbuild nie typecheckuje)
npm run lint          # biome check src/
npm run build         # tsup → dist/index.js
```

## Standardy kodu

Projekt używa TypeScript w trybie strict. Przed wysłaniem PR upewnij się że:

- `npm run typecheck` nie zwraca błędów
- `npm run lint` przechodzi (biome; repo używa LF — patrz `.gitattributes`)
- `npm test` — wszystkie testy przechodzą
- `npm run build` przechodzi (tsup)
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
