/**
 * Zarządzanie tokenami JWT (zapis, odczyt, refresh)
 */

import type { IConfig, TEnvironment } from '../types.ts';
import { deleteFile, fileExists, readJsonFile, writeJsonFile } from '../utils/file-system.ts';
import { post, TIMEOUTS } from '../utils/http-client.ts';
import logger, { maskSensitiveData } from '../utils/logger.ts';

/** Uprawnienia pliku tokenów: odczyt i zapis tylko dla właściciela (rw-------). Na Windows no-op. */
const TOKEN_FILE_MODE = 0o600;

interface ITokenData {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  savedAt: number;
  nip: string;
  environment: TEnvironment;
}

interface IJwtPayload {
  exp: number;
  [key: string]: unknown;
}

type TTokensReturn = {
  readonly accessToken: string;
  readonly refreshToken: string;
};

/**
 * Normalizuje token zwrócony przez API KSeF.
 * W niektórych miejscach API zwraca string JWT, a w innych obiekt { token, validUntil }.
 *
 * @param {string|{token:string}|null|undefined} maybeToken
 * @returns {string}
 * @throws {Error} Gdy token jest nieprawidłowy lub brakuje
 */
function normalizeJwtToken(maybeToken: string | { token: string } | null | undefined): string {
  if (!maybeToken) {
    throw new Error('Missing JWT token');
  }

  if (typeof maybeToken === 'string') {
    return maybeToken;
  }

  if (typeof maybeToken === 'object' && maybeToken.token) {
    return maybeToken.token;
  }

  throw new Error('Invalid JWT token shape');
}

/**
 * Dekoduje payload JWT (bez weryfikacji podpisu)
 * @param {string} token - Token JWT
 * @returns {Object} Zdekodowany payload
 * @throws {Error} Gdy nie udało się zdekodować tokenu
 */
export function decodeJwtPayload(token: string): IJwtPayload {
  try {
    const parts = normalizeJwtToken(token).split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    // JWT używa base64url, ale Buffer potrafi to przełknąć po drobnej normalizacji.
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = payload.length % 4;
    const padded = pad ? payload + '='.repeat(4 - pad) : payload;

    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(decoded) as IJwtPayload;
  } catch (error) {
    logger.error(`JWT decode error: ${(error as Error).message}`);
    if ((error as Error).stack) {
      logger.debug(`Stack trace: ${(error as Error).stack}`);
    }
    throw new Error(`Failed to decode JWT: ${(error as Error).message}`);
  }
}

/**
 * Sprawdza czy accessToken jest ważny
 * @param {string} accessToken - Token dostępowy JWT
 * @param {number} bufferMinutes - Margines bezpieczeństwa w minutach (domyślnie 2)
 * @returns {boolean} true jeśli token jest ważny
 */
export function isAccessTokenValid(accessToken: string, bufferMinutes: number = 2): boolean {
  try {
    const payload = decodeJwtPayload(accessToken);
    const expMs = payload.exp * 1000; // exp jest w sekundach
    const nowMs = Date.now();
    const bufferMs = bufferMinutes * 60 * 1000;

    return expMs > nowMs + bufferMs;
  } catch {
    return false;
  }
}

/**
 * Sprawdza czy refreshToken jest ważny
 * @param {string} refreshToken - Token odświeżający JWT
 * @returns {boolean} true jeśli token jest ważny
 */
export function isRefreshTokenValid(refreshToken: string): boolean {
  try {
    const payload = decodeJwtPayload(refreshToken);
    const expMs = payload.exp * 1000;
    const nowMs = Date.now();

    return expMs > nowMs;
  } catch {
    return false;
  }
}

/**
 * Zapisuje tokeny do pliku
 * @param {string} accessToken - Token dostępowy
 * @param {string} refreshToken - Token odświeżający
 * @param {Object} config - Konfiguracja aplikacji
 * @throws {Error} Gdy nie udało się zapisać tokenów
 */
export async function saveTokens(accessToken: string, refreshToken: string, config: IConfig): Promise<void> {
  const normalizedAccess = normalizeJwtToken(accessToken);
  const normalizedRefresh = normalizeJwtToken(refreshToken);

  const accessPayload = decodeJwtPayload(normalizedAccess);
  const refreshPayload = decodeJwtPayload(normalizedRefresh);

  const tokenData: ITokenData = {
    accessToken: normalizedAccess,
    refreshToken: normalizedRefresh,
    accessTokenExpiresAt: accessPayload.exp * 1000,
    refreshTokenExpiresAt: refreshPayload.exp * 1000,
    savedAt: Date.now(),
    nip: config.nip,
    environment: config.env,
  };

  await writeJsonFile(config.tokenStoragePath, tokenData, TOKEN_FILE_MODE);

  const accessExpiresDate = new Date(accessPayload.exp * 1000);
  logger.info(`Tokens saved. Access token valid until ${accessExpiresDate.toLocaleString()}`);
  logger.debug(`Access token: ${maskSensitiveData(normalizedAccess)}`);
  logger.debug(`Refresh token: ${maskSensitiveData(normalizedRefresh)}`);
}

/**
 * Wczytuje tokeny z pliku
 * @param {Object} config - Konfiguracja aplikacji
 * @returns {Promise<Object|null>} Dane tokenów lub null jeśli nie istnieją/niepoprawne
 */
export async function loadTokens(config: IConfig): Promise<ITokenData | null> {
  try {
    if (!(await fileExists(config.tokenStoragePath))) {
      logger.debug('Token file not found');
      return null;
    }

    logger.info(`Loading tokens from ${config.tokenStoragePath}`);

    const tokenData = (await readJsonFile(config.tokenStoragePath)) as ITokenData;

    // Walidacja struktury
    if (!tokenData.accessToken || !tokenData.refreshToken) {
      logger.warn('Token file corrupted (missing tokens), deleting...');
      await deleteFile(config.tokenStoragePath);
      return null;
    }

    // Walidacja zgodności NIP
    if (tokenData.nip !== config.nip) {
      logger.warn(`NIP mismatch in token file (cached: ${tokenData.nip}, current: ${config.nip})`);
      await deleteFile(config.tokenStoragePath);
      return null;
    }

    // Walidacja zgodności środowiska
    if (tokenData.environment !== config.env) {
      logger.warn(`Environment mismatch in token file (cached: ${tokenData.environment}, current: ${config.env})`);
      await deleteFile(config.tokenStoragePath);
      return null;
    }

    return tokenData;
  } catch (error) {
    logger.error(`Error loading tokens: ${(error as Error).message}`);
    if ((error as Error).stack) {
      logger.debug(`Stack trace: ${(error as Error).stack}`);
    }
    // Usuń zepsuty plik tokenów i pozwól na ponowne logowanie
    try {
      await deleteTokenFile(config);
    } catch (deleteError) {
      logger.debug(`Failed to delete corrupted token file: ${(deleteError as Error).message}`);
    }
    return null;
  }
}

/**
 * Odświeża accessToken przy użyciu refreshToken
 * @param {string} refreshToken - Token odświeżający
 * @param {string} baseUrl - Bazowy URL API
 * @returns {Promise<Object>} Nowe tokeny (accessToken i refreshToken)
 * @throws {Error} Gdy nie udało się odświeżyć tokenów
 */
export async function refreshAccessToken(refreshToken: string, baseUrl: string): Promise<TTokensReturn> {
  const url = `${baseUrl}/v2/auth/token/refresh`;

  logger.info('Refreshing access token...');

  const normalizedRefresh = normalizeJwtToken(refreshToken);

  const response = await post(
    url,
    {},
    {
      Authorization: `Bearer ${normalizedRefresh}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    TIMEOUTS.AUTH,
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: HTTP ${response.status} - ${errorText}`);
  }

  const result = (await response.json()) as {
    accessToken: string | { token: string };
    refreshToken: string | { token: string };
  };

  const newAccessToken = normalizeJwtToken(result.accessToken);
  const newRefreshToken = normalizeJwtToken(result.refreshToken);

  logger.info('Token Access został pomyślnie odświeżony');
  logger.debug(`New access token: ${maskSensitiveData(newAccessToken)}`);
  logger.debug(`New refresh token: ${maskSensitiveData(newRefreshToken)}`);

  return Object.freeze<TTokensReturn>({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  });
}

/**
 * Usuwa plik z tokenami
 * @param {Object} config - Konfiguracja aplikacji
 */
export async function deleteTokenFile(config: IConfig): Promise<void> {
  try {
    await deleteFile(config.tokenStoragePath);
    logger.debug('Token file deleted');
  } catch (error) {
    logger.debug(`Failed to delete token file: ${(error as Error).message}`);
  }
}

/**
 * Alias dla deleteTokenFile
 * @param {Object} config - Konfiguracja aplikacji
 */
export async function clearTokens(config: IConfig): Promise<void> {
  await deleteTokenFile(config);
}

/**
 * Pobiera ważny accessToken (z cache lub przez refresh)
 * @param {Object} config - Konfiguracja aplikacji
 * @returns {Promise<Object|null>} Obiekt z accessToken i refreshToken lub null (wymaga pełnego logowania)
 */
export async function getValidAccessToken(config: IConfig): Promise<TTokensReturn | null> {
  const tokenData = await loadTokens(config);

  if (!tokenData) {
    return null;
  }

  // Sprawdź czy accessToken jest ważny
  if (isAccessTokenValid(tokenData.accessToken, config.tokenRefreshMarginMinutes)) {
    const expiresAt = new Date(tokenData.accessTokenExpiresAt);
    logger.info(`Access token valid until ${expiresAt.toLocaleString()}`);
    logger.info('Using cached session (no login required)');
    return Object.freeze<TTokensReturn>({
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
    });
  }

  logger.warn('Access token expired, attempting refresh...');

  // Sprawdź czy refreshToken jest ważny
  if (!isRefreshTokenValid(tokenData.refreshToken)) {
    logger.warn('Refresh token expired, full login required');
    await deleteTokenFile(config);
    return null;
  }

  // Odśwież tokeny
  try {
    const newTokens = await refreshAccessToken(tokenData.refreshToken, config.baseUrl);

    // Zapisz nowe tokeny (WAŻNE: oba tokeny są nowe!)
    await saveTokens(newTokens.accessToken, newTokens.refreshToken, config);

    return newTokens;
  } catch (error) {
    logger.error(`Token refresh failed: ${(error as Error).message}`);
    if ((error as Error).stack) {
      logger.debug(`Stack trace: ${(error as Error).stack}`);
    }
    await deleteTokenFile(config);
    return null;
  }
}
