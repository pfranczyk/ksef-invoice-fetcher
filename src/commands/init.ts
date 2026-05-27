/**
 * Komenda `ksef init <nip> [env]` — scaffolduje katalog `.ksef/` w bieżącym katalogu roboczym.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getKsefDir, type IKsefConfigFile, writeKsefConfigFile } from '../config/env.ts';
import type { TEnvironment } from '../types.ts';
import logger from '../utils/logger.ts';
import { validateNIP } from '../utils/validator.ts';
import { logProductionWarning } from './_shared.ts';

const VALID_ENVIRONMENTS = Object.freeze<readonly TEnvironment[]>(['DEMO', 'TEST', 'PRD']);

const README_CONTENT = `KSeF — katalog roboczy klienta

Struktura:
  config.json     — konfiguracja (NIP, środowisko, parametry)
  ksef.token      — token KSeF wygenerowany w portalu KSeF (do wklejenia)
  tokens.json     — cache JWT (powstaje po pierwszym \`ksef login\`)
  public-key.pem  — klucz publiczny KSeF (pobierany automatycznie)
  tmp/            — pliki tymczasowe

Pierwsze kroki:
  1. Zaloguj się do portalu KSeF dla wybranego środowiska.
  2. Wygeneruj token o uprawnieniach InvoiceRead.
  3. Wklej token do pliku ksef.token (sam string, bez znaków białych).
  4. Uruchom \`ksef login\` w katalogu klienta.
`;

/**
 * Normalizuje wartość środowiska do dozwolonego enum.
 * @param {string | undefined} value - Wartość z CLI (case-insensitive)
 * @returns {TEnvironment} Znormalizowana wartość środowiska
 * @throws {Error} Gdy wartość nie pasuje do DEMO|TEST|PRD
 */
function normalizeEnvironment(value: string | undefined): TEnvironment {
  if (!value) {
    return 'PRD';
  }
  const upper = value.toUpperCase();
  if (!VALID_ENVIRONMENTS.includes(upper as TEnvironment)) {
    throw new Error(`Niepoprawne środowisko: "${value}". Dozwolone: DEMO, TEST, PRD.`);
  }
  return upper as TEnvironment;
}

/**
 * Handler komendy `init`: tworzy katalog `.ksef/` z konfiguracją, pustym plikiem tokenu i instrukcją.
 * Idempotentny — nie nadpisuje istniejącego `ksef.token`.
 * @param {string} nip - NIP podatnika (10 cyfr z poprawną sumą kontrolną)
 * @param {string | undefined} envArg - Środowisko KSeF (DEMO|TEST|PRD), domyślnie PRD
 * @returns {Promise<void>}
 * @throws {Error} Gdy NIP lub środowisko są niepoprawne
 */
export async function initCmd(nip: string, envArg?: string): Promise<void> {
  validateNIP(nip);
  const environment = normalizeEnvironment(envArg);

  const ksefDir = getKsefDir();
  mkdirSync(ksefDir, { recursive: true });

  const config: IKsefConfigFile = { nip, environment };
  writeKsefConfigFile(config);
  logger.info(`✓ Utworzono ${resolve(ksefDir, 'config.json')} (NIP: ${nip}, środowisko: ${environment})`);

  const tokenPath = resolve(ksefDir, 'ksef.token');
  if (existsSync(tokenPath)) {
    logger.info(`Plik tokenu już istnieje, pomijam: ${tokenPath}`);
  } else {
    writeFileSync(tokenPath, '', 'utf-8');
    logger.info(`✓ Utworzono pusty ${tokenPath}`);
  }

  const readmePath = resolve(ksefDir, 'README.txt');
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, README_CONTENT, 'utf-8');
  }

  logger.info('');
  logger.info(`Następny krok: otwórz ${tokenPath}`);
  logger.info(`i wklej token KSeF wygenerowany w portalu KSeF dla środowiska ${environment}.`);
  logger.info('Następnie uruchom: ksef login');

  if (environment === 'PRD') {
    logger.info('');
    logProductionWarning();
  }
}
