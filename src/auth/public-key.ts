/**
 * Pobieranie i cache klucza publicznego KSeF
 */

import forge from 'node-forge';
import { getApiUrl } from '../config/env.ts';
import type { IConfig, TEnvironment } from '../types.ts';
import { fileExists, readFile, writeFile } from '../utils/file-system.ts';
import { get, TIMEOUTS } from '../utils/http-client.ts';
import logger from '../utils/logger.ts';

const KSEF_TOKEN_ENCRYPTION_USAGE = 'KsefTokenEncryption';

interface ICertificate {
  certificate: string;
  usage: string[];
  validFrom: string;
  validTo: string;
}

function isCertificateCurrentlyValid(validFrom: string, validTo: string, now: Date = new Date()): boolean {
  const from = validFrom ? new Date(validFrom) : null;
  const to = validTo ? new Date(validTo) : null;

  if (from && Number.isNaN(from.getTime())) return false;
  if (to && Number.isNaN(to.getTime())) return false;

  if (from && now < from) return false;
  return !(to && now > to);
}

function chooseCertificate(certificates: ICertificate[], usage: string = KSEF_TOKEN_ENCRYPTION_USAGE): ICertificate {
  if (!Array.isArray(certificates)) {
    throw new Error('Invalid response: expected an array of public key certificates');
  }

  const now = new Date();

  const matching = certificates
    .filter((c) => c && Array.isArray(c.usage) && c.usage.includes(usage))
    .filter((c) => isCertificateCurrentlyValid(c.validFrom, c.validTo, now));

  if (matching.length === 0) {
    const availableUsages = certificates.flatMap((c) => (c && Array.isArray(c.usage) ? c.usage : [])).filter(Boolean);
    throw new Error(
      `No currently valid certificate found for usage=${usage}. Available usages: ${[...new Set(availableUsages)].join(', ') || '(none)'}`,
    );
  }

  // Prefer the one with the latest validTo
  matching.sort((a, b) => {
    const aTo = a.validTo ? new Date(a.validTo).getTime() : 0;
    const bTo = b.validTo ? new Date(b.validTo).getTime() : 0;
    return bTo - aTo;
  });

  return matching[0];
}

function derBase64CertToPemCertificate(certBase64Der: string): string {
  if (!certBase64Der) {
    throw new Error('Invalid certificate: expected Base64-encoded DER string');
  }

  // API returns DER as Base64 (not PEM)
  const derBytes = forge.util.decode64(certBase64Der.trim());
  const asn1 = forge.asn1.fromDer(derBytes);
  const cert = forge.pki.certificateFromAsn1(asn1);
  return forge.pki.certificateToPem(cert);
}

function isCachedPemCertificateValid(pemCert: string, now: Date = new Date()): boolean {
  try {
    const cert = forge.pki.certificateFromPem((pemCert || '').toString());
    const notBefore = cert.validity?.notBefore;
    const notAfter = cert.validity?.notAfter;

    if (!(notBefore instanceof Date) || Number.isNaN(notBefore.getTime())) return false;
    if (!(notAfter instanceof Date) || Number.isNaN(notAfter.getTime())) return false;

    return now >= notBefore && now <= notAfter;
  } catch {
    return false;
  }
}

/**
 * Pobiera certyfikaty klucza publicznego z API KSeF i wybiera certyfikat do szyfrowania tokenów (KsefTokenEncryption).
 * API zwraca certyfikat X.509 w DER zakodowany Base64. Funkcja konwertuje go do PEM.
 *
 * @param {string} env - Środowisko (DEMO, TEST, PRD)
 * @returns {Promise<string>} Certyfikat X.509 w formacie PEM
 * @throws {Error} Gdy nie udało się pobrać lub przetworzyć certyfikatu
 */
export async function downloadPublicKeyFromAPI(env: TEnvironment): Promise<string> {
  try {
    const baseUrl = getApiUrl(env);
    const url = `${baseUrl}/v2/security/public-key-certificates`;

    logger.debug(`Downloading public key certificate from ${url}`);

    const response = await get(url, {}, TIMEOUTS.PUBLIC_KEY);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Failed to download public key certificates: HTTP ${response.status}${errorText ? ` - ${errorText}` : ''}`,
      );
    }

    const certificates = (await response.json()) as ICertificate[];
    const selected = chooseCertificate(certificates, KSEF_TOKEN_ENCRYPTION_USAGE);

    const pemCert = derBase64CertToPemCertificate(selected.certificate);

    logger.debug(
      `Selected certificate: usage=${selected.usage?.join(',')}, validFrom=${selected.validFrom}, validTo=${selected.validTo}`,
    );

    return pemCert;
  } catch (error) {
    logger.error(`Błąd w downloadPublicKeyFromAPI: ${(error as Error).message}`);
    if ((error as Error).stack) {
      logger.debug(`Stack trace: ${(error as Error).stack}`);
    }
    throw error;
  }
}

/**
 * Główna funkcja pobierania certyfikatu klucza publicznego do szyfrowania tokena (KsefTokenEncryption)
 * Algorytm: cache lokalny → API → error
 *
 * Zapisuje do `publicKeyPath` certyfikat X.509 w PEM wybrany z `/security/public-key-certificates`.
 * Ten certyfikat jest używany w procesie „Uwierzytelnienie z wykorzystaniem tokena KSeF”
 * (szyfrowanie `encryptedToken` w `submitKsefTokenAuth`).
 *
 * @param {Object} config - Konfiguracja aplikacji
 * @returns {Promise<string>} Certyfikat X.509 w formacie PEM
 * @throws {Error} Gdy nie udało się pobrać lub odczytać certyfikatu
 */
export async function getPublicKey(config: IConfig): Promise<string> {
  try {
    const { publicKeyPath, env } = config;

    // 1. Sprawdzenie cache lokalnego
    if (await fileExists(publicKeyPath)) {
      const cached = await readFile(publicKeyPath);

      if (isCachedPemCertificateValid(cached)) {
        logger.info(`Using cached KSeF public key certificate: ${publicKeyPath}`);
        return cached;
      }

      logger.warn(
        `Cached KSeF public key certificate is expired/invalid: ${publicKeyPath}. Downloading a fresh one...`,
      );
    }

    // 2. Próba pobrania z API
    logger.info(`Downloading KSeF public key certificate (usage=${KSEF_TOKEN_ENCRYPTION_USAGE}) from ${env} API...`);

    const pemCert = await downloadPublicKeyFromAPI(env);

    // Zapis do cache
    await writeFile(publicKeyPath, pemCert);
    logger.info(`KSeF public key certificate saved to: ${publicKeyPath}`);

    return pemCert;
  } catch (error) {
    logger.error(`Błąd w getPublicKey: ${(error as Error).message}`);
    if ((error as Error).stack) {
      logger.debug(`Stack trace: ${(error as Error).stack}`);
    }
    throw error;
  }
}
