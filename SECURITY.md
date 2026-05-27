# Security Policy

## Obsługiwane wersje

Poprawki bezpieczeństwa są wydawane dla najnowszej wersji projektu.

## Zgłaszanie podatności

**Nie zgłaszaj podatności bezpieczeństwa przez publiczne issues GitHub.**

Zamiast tego skorzystaj z mechanizmu [GitHub Private Security Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) dostępnego w zakładce **Security → Report a vulnerability**.

Prosimy o podanie w zgłoszeniu:

- Opis podatności i potencjalny wpływ
- Kroki do reprodukcji
- Sugerowana poprawka (opcjonalnie)

## Zakres

Projekt integruje się z KSeF (Krajowy System e-Faktur) — system podatkowy Ministerstwa Finansów RP. Szczególnie istotne obszary bezpieczeństwa:

- Obsługa tokenów uwierzytelniających KSeF (przechowywanie, szyfrowanie RSA-OAEP, odświeżanie)
- Szyfrowanie AES-256-CBC pobranych paczek z fakturami
- Walidacja i maskowanie danych wrażliwych w logach (NIP, tokeny)
- Bezpieczeństwo katalogu `.ksef/` w katalogu klienta (token KSeF, cache JWT, klucz publiczny)

## Czego nie zgłaszać

- Błędów w zewnętrznym API KSeF (zgłoś je do MF: https://www.podatki.gov.pl/ksef/)
- Problemów z konfiguracją środowiska użytkownika
