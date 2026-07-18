# Changelog

Wszystkie istotne zmiany w projekcie dokumentowane są w tym pliku. Format inspirowany [Keep a Changelog](https://keepachangelog.com/), wersjonowanie zgodne z [SemVer](https://semver.org/).

## [0.7.1] — 2026-07-18

### Bezpieczeństwo

- Aktualizacja `adm-zip` do 0.6.0 — usuwa podatność CVE-2026-39244
  (nieograniczona alokacja pamięci przy rozpakowywaniu złośliwie
  spreparowanego archiwum ZIP paczki eksportu faktur).

### Zmieniono

- Aktualizacja `commander` do 15.0.0.

## [0.7.0] — 2026-05-27

Pierwsze publiczne wydanie programu `ksef` na npm pod scoped name
**`@logrox/ksef`**. Wersje 0.1.0 – 0.6.0 były dystrybuowane prywatnie
i nie trafiały do publicznego npm registry.

### Dodano

- Subkomendy CLI: `login`, `fetch`, `pdf`, `init`, `margin`, `interval`,
  `help`. Każda komenda ma własny `--help` (`ksef help fetch`).
- Tryb pracy z wieloma klientami — konfiguracja (`.ksef/config.json`),
  token KSeF, cache JWT i wynikowe pliki (`xml/`, `pdf/`) trzymane są
  w katalogu, z którego uruchomiono `ksef`. Każdego klienta obsługuje się
  z osobnego folderu, bez zmiany ustawień globalnych.
- Pełne odwzorowanie faktury FA(3) w generowanym PDF (zgodne ze schematem
  Ministerstwa Finansów). Sekcje opcjonalne — podmiot trzeci, rabaty,
  kody GTU/CN, adnotacje, rozliczenie — pokazywane na PDF tylko wtedy,
  gdy faktycznie występują w fakturze, bez pustych nagłówków.

### Zmieniono

- Generowanie PDF działa w całości w procesie Node — nie wymaga już
  LibreOffice ani żadnej zależności systemowej. Po `npm install -g
  @logrox/ksef` polecenie `ksef pdf` jest od razu gotowe do użycia
  na Windows, macOS i Linux.

### Naprawiono

- Pole „Do zapłaty" na PDF pokazuje teraz wartość zgodną z fakturą
  w KSeF — brana jest z autorytatywnych pól XML (`Zaplacono`,
  `DoZaplaty`, `DoRozliczenia`, `P_15`) zamiast obliczana z sumy pozycji,
  co mogło wcześniej dawać różnicę grosza przy fakturach z rabatami.

### Usunięto

- Wymaganie posiadania LibreOffice w systemie do generowania PDF.

## [0.6.0]

Punkt startowy liczenia zmian w niniejszym dokumencie.

[Unreleased]: https://github.com/pfranczyk/ksef-invoice-fetcher/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/pfranczyk/ksef-invoice-fetcher/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/pfranczyk/ksef-invoice-fetcher/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/pfranczyk/ksef-invoice-fetcher/releases/tag/v0.6.0
