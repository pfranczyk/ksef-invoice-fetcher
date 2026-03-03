/**
 * Kryptografia dla eksportu faktur
 * Generowanie kluczy AES-256, szyfrowanie/deszyfrowanie, weryfikacja hashy
 */

import crypto from 'node:crypto';
import forge from 'node-forge';
import type { IConfig } from '../types.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * Certyfikat z API KSeF
 */
interface ICertificate {
  certificate: string;
  usage?: string[];
  validFrom?: string;
  validTo?: string;
}

/**
 * Odpowiedź API z certyfikatami
 */
interface ICertificatesResponse extends Array<ICertificate> {}

/**
 * Parametry szyfrowania dla eksportu
 */
type TEncryptionParams = {
  readonly aesKey: Buffer;
  readonly iv: Buffer;
  readonly encryptedSymmetricKey: string;
  readonly initializationVector: string;
};

/**
 * Parametry deszyfrowania AES-256-CBC
 */
type TDecryptAes256CbcParams = {
  readonly encryptedData: Buffer;
  readonly aesKey: Buffer;
  readonly iv: Buffer;
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Pobiera certyfikat dla szyfrowania eksportu (usage: SymmetricKeyEncryption)
 * @param {IConfig} config - Konfiguracja aplikacji
 * @returns {Promise<string>} Certyfikat w formacie PEM
 * @throws {Error} Gdy nie udało się pobrać lub znaleźć odpowiedniego certyfikatu
 */
async function getEncryptionCertificate(config: IConfig): Promise<string> {
  // Pobierz wszystkie certyfikaty z API
  const baseUrl: string = config.baseUrl;
  const url: string = `${baseUrl}/v2/security/public-key-certificates`;

  const response: Response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Nie udało się pobrać certyfikatów klucza publicznego: HTTP ${response.status}`);
  }

  const certificates: ICertificatesResponse = await response.json();

  // Znajdź certyfikat z usage: SymmetricKeyEncryption
  const now: Date = new Date();
  const validCerts: ICertificate[] = certificates.filter((cert: ICertificate): boolean => {
    if (!Array.isArray(cert.usage) || !cert.usage.includes('SymmetricKeyEncryption')) {
      return false;
    }

    const validFrom: Date | null = cert.validFrom ? new Date(cert.validFrom) : null;
    const validTo: Date | null = cert.validTo ? new Date(cert.validTo) : null;

    if (validFrom && now < validFrom) return false;
    return !(validTo && now > validTo);
  });

  if (validCerts.length === 0) {
    throw new Error('Nie znaleziono ważnego certyfikatu z usage: SymmetricKeyEncryption');
  }

  // Wybierz certyfikat z najdłuższą ważnością
  validCerts.sort((a: ICertificate, b: ICertificate): number => {
    const aTo: number = a.validTo ? new Date(a.validTo).getTime() : 0;
    const bTo: number = b.validTo ? new Date(b.validTo).getTime() : 0;
    return bTo - aTo;
  });

  const selectedCert: ICertificate = validCerts[0];

  // Konwertuj DER Base64 na PEM
  const derBytes: string = forge.util.decode64(selectedCert.certificate.trim());
  const asn1: forge.asn1.Asn1 = forge.asn1.fromDer(derBytes);
  const cert: forge.pki.Certificate = forge.pki.certificateFromAsn1(asn1);
  return forge.pki.certificateToPem(cert);
}

/**
 * Generuje parametry szyfrowania dla eksportu faktur
 * @param {IConfig} config - Konfiguracja aplikacji
 * @returns {Promise<TEncryptionParams>} Parametry szyfrowania
 * @throws {Error} Gdy nie udało się wygenerować parametrów szyfrowania
 */
export async function generateEncryptionParams(config: IConfig): Promise<TEncryptionParams> {
  // Generuj 32-bajtowy klucz AES-256
  const aesKeyBytes: string = forge.random.getBytesSync(32);
  const aesKey: Buffer = Buffer.from(aesKeyBytes, 'binary');

  // Generuj 16-bajtowy IV
  const ivBytes: string = forge.random.getBytesSync(16);
  const iv: Buffer = Buffer.from(ivBytes, 'binary');

  // Pobierz certyfikat dla szyfrowania eksportu (usage: SymmetricKeyEncryption)
  const publicKeyPem: string = await getEncryptionCertificate(config);

  // Szyfruj klucz AES za pomocą RSA-OAEP SHA-256
  const publicKey: forge.pki.rsa.PublicKey = forge.pki.certificateFromPem(publicKeyPem)
    .publicKey as forge.pki.rsa.PublicKey;
  const encryptedKey: string = publicKey.encrypt(aesKeyBytes, 'RSA-OAEP', {
    md: forge.md.sha256.create(),
    mgf1: {
      md: forge.md.sha256.create(),
    },
  });

  return {
    aesKey,
    iv,
    encryptedSymmetricKey: forge.util.encode64(encryptedKey),
    initializationVector: forge.util.encode64(ivBytes),
  };
}

/**
 * Odszyfrowuje dane za pomocą AES-256-CBC
 * @param {TDecryptAes256CbcParams} params - Parametry deszyfrowania
 * @returns {Buffer} Odszyfrowane dane
 * @throws {Error} Gdy nie udało się odszyfrować danych
 */
export function decryptAes256Cbc({ encryptedData, aesKey, iv }: TDecryptAes256CbcParams): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

/**
 * Oblicza hash SHA-256 i koduje w Base64
 * @param {Buffer} buffer - Dane do zahashowania
 * @returns {string} Hash w formacie Base64
 */
export function computeSha256Base64(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('base64');
}

/**
 * Sprawdza czy bufor zaczyna się od magic bytes ZIP
 * @param {Buffer} buffer - Bufor do sprawdzenia
 * @returns {boolean} true jeśli to ZIP
 */
export function isZipMagicBytes(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 4) {
    return false;
  }
  // ZIP signature: 50 4B 03 04
  return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}
