/**
 * Funkcje kryptograficzne RSA
 */
import forge from 'node-forge';

/**
 * Sprawdza czy ciąg znaków wygląda jak certyfikat PEM (X.509)
 * @param {string} pem - Ciąg do sprawdzenia
 * @returns {boolean} True jeśli zawiera nagłówki certyfikatu PEM
 */
function isProbablyPemCertificate(pem: string): boolean {
  return pem.includes('BEGIN CERTIFICATE') || pem.includes('END CERTIFICATE');
}

/**
 * Opakowuje surowy Base64 w nagłówki certyfikatu PEM jeśli ich brak.
 * Niektóre pliki .crt są zapisywane jako sam Base64 bez nagłówków BEGIN/END.
 * @param {string} maybePemOrBareBase64 - Certyfikat PEM lub surowy Base64
 * @returns {string} Certyfikat w formacie PEM
 */
function wrapAsPemCertificateIfNeeded(maybePemOrBareBase64: string): string {
  const s = (maybePemOrBareBase64 || '').trim();
  if (!s) return s;

  if (isProbablyPemCertificate(s)) return s;

  // Czasem .crt bywa zapisany jako sam Base64 bez nagłówków.
  // Spróbujmy opakować jako PEM certyfikatu.
  if (/^[A-Za-z0-9+/\r\n=]+$/.test(s) && s.length > 64) {
    const b64 = s.replace(/\s+/g, '');
    const lines = b64.match(/.{1,64}/g) || [b64];
    return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
  }

  return s;
}

/**
 * Parsuje klucz publiczny RSA z PEM — obsługuje zarówno czysty public key PEM
 * jak i certyfikat X.509 w formacie PEM (wyciąga z niego klucz publiczny).
 * @param {string} publicKeyOrCertificatePem - Klucz publiczny lub certyfikat X.509 w formacie PEM
 * @returns {forge.pki.rsa.PublicKey} Sparsowany klucz publiczny RSA
 * @throws {Error} Gdy nie udało się sparsować certyfikatu lub klucza publicznego
 */
function toPublicKeyFromPem(publicKeyOrCertificatePem: string): forge.pki.rsa.PublicKey {
  const raw = (publicKeyOrCertificatePem || '').toString();
  const pem = wrapAsPemCertificateIfNeeded(raw);

  // Jeśli to certyfikat X.509, wyciągamy z niego klucz publiczny.
  if (isProbablyPemCertificate(pem)) {
    try {
      const cert = forge.pki.certificateFromPem(pem);
      return cert.publicKey as forge.pki.rsa.PublicKey;
    } catch (error) {
      throw new Error(`Nie udało się sparsować certyfikatu PEM: ${(error as Error).message}`);
    }
  }

  // W przeciwnym razie zakładamy, że to public key PEM.
  try {
    return forge.pki.publicKeyFromPem(pem);
  } catch (error) {
    throw new Error(`Nie udało się sparsować klucza publicznego PEM: ${(error as Error).message}`);
  }
}

/**
 * Szyfruje dane przy użyciu RSA-OAEP z SHA-256
 * @param {string} data - Dane do zaszyfrowania
 * @param {string} publicKeyPem - Klucz publiczny w formacie PEM (lub certyfikat X.509 w PEM)
 * @returns {string} Zaszyfrowane dane w formacie Base64
 * @throws {Error} Gdy nie udało się zaszyfrować danych
 */
export function encryptRSA(data: string, publicKeyPem: string): string {
  try {
    const publicKey = toPublicKeyFromPem(publicKeyPem);
    // Szyfrowanie RSA-OAEP z SHA-256
    const encrypted = publicKey.encrypt(data, 'RSA-OAEP', {
      md: forge.md.sha256.create(),
      mgf1: {
        md: forge.md.sha256.create(),
      },
    });

    // Kodowanie wyniku w Base64
    return forge.util.encode64(encrypted);
  } catch (error) {
    throw new Error(`Błąd szyfrowania RSA: ${(error as Error).message}`);
  }
}

/**
 * Tworzy payload tokena (token + timestamp)
 * @param {string} token - Token KSeF
 * @param {number} timestampMs - Unix timestamp w milisekundach
 * @returns {string} Payload w formacie "token|timestamp"
 */
export function createTokenPayload(token: string, timestampMs: number): string {
  return `${token}|${timestampMs}`;
}

/**
 * Szyfruje token KSeF dla uwierzytelniania
 * @param {string} token - Token KSeF
 * @param {number} timestampMs - Unix timestamp w milisekundach
 * @param {string} publicKeyPem - Klucz publiczny KSeF w formacie PEM
 * @returns {string} Zaszyfrowany token w formacie Base64
 * @throws {Error} Gdy nie udało się zaszyfrować tokenu
 */
export function encryptKsefToken(token: string, timestampMs: number, publicKeyPem: string): string {
  try {
    const payload = createTokenPayload(token, timestampMs);
    return encryptRSA(payload, publicKeyPem);
  } catch (error) {
    throw new Error(`Błąd szyfrowania tokenu KSeF: ${(error as Error).message}`);
  }
}

/**
 * Generuje losowy klucz AES-256 (32 bajty)
 * @returns {Buffer} Klucz AES
 */
export function generateAesKey(): string {
  return forge.random.getBytesSync(32);
}

/**
 * Generuje losowy wektor inicjalizacyjny (IV) dla AES (16 bajtów)
 * @returns {Buffer} IV
 */
export function generateIV(): string {
  return forge.random.getBytesSync(16);
}

/**
 * Szyfruje klucz AES przy użyciu RSA-OAEP z SHA-256
 * @param {string} aesKey - Klucz AES (raw bytes)
 * @param {string} publicKeyPem - Klucz publiczny w formacie PEM
 * @returns {string} Zaszyfrowany klucz w formacie Base64
 * @throws {Error} Gdy nie udało się zaszyfrować klucza AES
 */
export function encryptAesKey(aesKey: string, publicKeyPem: string): string {
  return encryptRSA(aesKey, publicKeyPem);
}

/**
 * Koduje dane binarne w Base64
 * @param {string} data - Dane binarne
 * @returns {string} Dane w formacie Base64
 */
export function encodeBase64(data: string): string {
  return forge.util.encode64(data);
}

/**
 * Dekoduje dane z Base64
 * @param {string} base64 - Dane w formacie Base64
 * @returns {string} Zdekodowane dane binarne
 */
export function decodeBase64(base64: string): string {
  return forge.util.decode64(base64);
}
