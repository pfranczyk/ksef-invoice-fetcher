/**
 * Zarządzanie tokenami JWT (zapis, odczyt, usuwanie)
 */

import type { IConfig, TEnvironment } from '../types.ts';
import { deleteFile, fileExists, readJsonFile, writeJsonFile } from '../utils/file-system.ts';
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

/**
 * Dekoduje payload JWT (bez weryfikacji podpisu)
 * @param {string} token - Token JWT
 * @returns {Object} Zdekodowany payload
 * @throws {Error} Gdy nie udało się zdekodować tokenu
 */
export function decodeJwtPayload(token: string): IJwtPayload {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = payload.length % 4;
    const padded = pad ? payload + '='.repeat(4 - pad) : payload;

    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(decoded) as IJwtPayload;
  } catch (error) {
    throw new Error(`Failed to decode JWT: ${(error as Error).message}`);
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
  const accessPayload = decodeJwtPayload(accessToken);
  const refreshPayload = decodeJwtPayload(refreshToken);

  const tokenData: ITokenData = {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: accessPayload.exp * 1000,
    refreshTokenExpiresAt: refreshPayload.exp * 1000,
    savedAt: Date.now(),
    nip: config.nip,
    environment: config.env,
  };

  await writeJsonFile(config.tokenStoragePath, tokenData, TOKEN_FILE_MODE);

  const accessExpiresDate = new Date(accessPayload.exp * 1000);
  logger.info(`Tokens saved. Access token valid until ${accessExpiresDate.toLocaleString()}`);
  logger.debug(`Access token: ${maskSensitiveData(accessToken)}`);
  logger.debug(`Refresh token: ${maskSensitiveData(refreshToken)}`);
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

    if (!tokenData.accessToken || !tokenData.refreshToken) {
      logger.warn('Token file corrupted (missing tokens), deleting...');
      await deleteFile(config.tokenStoragePath);
      return null;
    }

    if (tokenData.nip !== config.nip) {
      logger.warn(`NIP mismatch in token file (cached: ${tokenData.nip}, current: ${config.nip})`);
      await deleteFile(config.tokenStoragePath);
      return null;
    }

    if (tokenData.environment !== config.env) {
      logger.warn(`Environment mismatch in token file (cached: ${tokenData.environment}, current: ${config.env})`);
      await deleteFile(config.tokenStoragePath);
      return null;
    }

    return tokenData;
  } catch (error) {
    logger.error(`Error loading tokens: ${(error as Error).message}`);
    try {
      await deleteFile(config.tokenStoragePath);
    } catch (deleteError) {
      logger.debug(`Failed to delete corrupted token file: ${(deleteError as Error).message}`);
    }
    return null;
  }
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
