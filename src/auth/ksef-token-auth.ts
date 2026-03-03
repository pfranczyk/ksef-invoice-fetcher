/**
 * Uwierzytelnianie przy użyciu tokena KSeF
 */

import type { IConfig } from '../types.ts';
import { readFile } from '../utils/file-system.ts';
import { post, TIMEOUTS } from '../utils/http-client.ts';
import logger, { maskSensitiveData } from '../utils/logger.ts';
import { sleep } from '../utils/sleep.ts';
import { getChallenge } from './challenge.ts';
import { encryptKsefToken } from './crypto.ts';
import { getPublicKey } from './public-key.ts';

type TSubmitKsefTokenAuthData = {
  readonly challenge: string;
  readonly encryptedToken: string;
  readonly nip: string;
};

interface IAuthenticationToken {
  validUntil: string;
  token: string;
}

interface ISubmitKsefTokenAuthResponse {
  authenticationToken: IAuthenticationToken;
  referenceNumber: string;
}

type TSubmitKsefTokenAuthReturn = {
  readonly authenticationToken: IAuthenticationToken;
  readonly referenceNumber: string;
};

type TPollAuthStatusOptions = {
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
};

interface IAuthStatusResponse {
  status?: {
    code: number;
  };
  processingCode?: number;
  processingDescription?: string;
}

interface IRedeemTokenResponse {
  accessToken: string | { token: string; validUntil: string };
  refreshToken: string | { token: string; validUntil: string };
}

type TTokensReturn = {
  readonly accessToken: string;
  readonly refreshToken: string;
};

/**
 * Wczytuje token KSeF z pliku
 * @param {string} tokenPath - Ścieżka do pliku z tokenem
 * @returns {Promise<string>} Token KSeF
 * @throws {Error} Gdy nie udało się wczytać tokenu
 */
export async function loadKsefToken(tokenPath: string): Promise<string> {
  const token = await readFile(tokenPath);
  return token.trim();
}

/**
 * Wysyła żądanie uwierzytelnienia tokenem KSeF
 * @param {Object} data - Dane uwierzytelnienia
 * @param {string} data.challenge - Challenge z API
 * @param {string} data.encryptedToken - Zaszyfrowany token
 * @param {string} data.nip - NIP kontekstu
 * @param {string} baseUrl - Bazowy URL API
 * @returns {Promise<{authenticationToken:{validUntil: string, token: string}, referenceNumber: string}>} Odpowiedź zawierająca authenticationToken i referenceNumber
 * @throws {Error} Gdy nie udało się uwierzytelnić
 */
export async function submitKsefTokenAuth(
  data: TSubmitKsefTokenAuthData,
  baseUrl: string,
): Promise<TSubmitKsefTokenAuthReturn> {
  const url = `${baseUrl}/v2/auth/ksef-token`;

  const body = {
    challenge: data.challenge,
    contextIdentifier: {
      type: 'Nip',
      value: data.nip,
    },
    encryptedToken: data.encryptedToken,
  };

  logger.debug(`Submitting KSeF token auth to ${url}`);

  const response = await post(url, body);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`KSeF token auth failed: HTTP ${response.status} - ${errorText}`);
  }

  const result = (await response.json()) as ISubmitKsefTokenAuthResponse;

  logger.debug(`Reference number: ${result.referenceNumber}`);

  return Object.freeze<TSubmitKsefTokenAuthReturn>({
    authenticationToken: result.authenticationToken,
    referenceNumber: result.referenceNumber,
  });
}

/**
 * Sprawdza status uwierzytelniania
 * @param {string} referenceNumber - Numer referencyjny operacji
 * @param {string} authToken - Token uwierzytelniający
 * @param {string} baseUrl - Bazowy URL API
 * @returns {Promise<Object>} Status uwierzytelniania
 * @throws {Error} Gdy nie udało się sprawdzić statusu
 */
export async function checkAuthStatus(
  referenceNumber: string,
  authToken: string,
  baseUrl: string,
): Promise<IAuthStatusResponse> {
  try {
    const url = `${baseUrl}/v2/auth/${referenceNumber}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Auth status check failed: HTTP ${response.status} - ${errorText}`);
    }

    return (await response.json()) as IAuthStatusResponse;
  } catch (error) {
    logger.error(`Błąd w checkAuthStatus dla ${referenceNumber}: ${(error as Error).message}`);
    if ((error as Error).stack) {
      logger.debug(`Stack trace: ${(error as Error).stack}`);
    }
    throw error;
  }
}

/**
 * Odpytuje o status uwierzytelniania do osiągnięcia sukcesu
 * @param {string} referenceNumber - Numer referencyjny operacji
 * @param {string} authToken - Token uwierzytelniający
 * @param {string} baseUrl - Bazowy URL API
 * @param {Object} options - Opcje pollingu
 * @param {number} options.intervalMs - Interwał odpytywania w ms (domyślnie 2000)
 * @param {number} options.timeoutMs - Timeout w ms (domyślnie 120000)
 * @returns {Promise<Object>} Status końcowy
 * @throws {Error} Gdy uwierzytelnianie nie powiodło się lub przekroczono timeout
 */
export async function pollAuthStatus(
  referenceNumber: string,
  authToken: string,
  baseUrl: string,
  options: TPollAuthStatusOptions = {},
): Promise<IAuthStatusResponse> {
  try {
    const { intervalMs = 2000, timeoutMs = 120000 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      logger.debug(`Polling auth status for ${referenceNumber}...`);

      const response = await checkAuthStatus(referenceNumber, authToken, baseUrl);

      // Sprawdź czy operacja zakończona
      if (response?.status?.code === 200) {
        logger.debug('Authentication completed successfully');
        return response;
      }

      // Sprawdź czy błąd
      if (response?.status?.code && response.status.code >= 400) {
        throw new Error(
          `Authentication failed with code ${response.processingCode}: ${response.processingDescription}`,
        );
      }

      await sleep(intervalMs);
    }

    throw new Error('Authentication timeout exceeded');
  } catch (error) {
    logger.error(`Błąd w pollAuthStatus dla ${referenceNumber}: ${(error as Error).message}`);
    if ((error as Error).stack) {
      logger.debug(`Stack trace: ${(error as Error).stack}`);
    }
    throw error;
  }
}

/**
 * Pobiera tokeny dostępowe (accessToken i refreshToken)
 * @param {string} authToken - Token uwierzytelniający
 * @param {string} baseUrl - Bazowy URL API
 * @returns {Promise<Object>} Obiekt z accessToken i refreshToken
 * @throws {Error} Gdy nie udało się pobrać tokenów
 */
export async function redeemToken(authToken: string, baseUrl: string): Promise<TTokensReturn> {
  try {
    const url = `${baseUrl}/v2/auth/token/redeem`;

    logger.debug('Redeeming authentication token for access tokens...');

    const response = await post(
      url,
      {},
      {
        Authorization: `Bearer ${authToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      TIMEOUTS.AUTH,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token redeem failed: HTTP ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as IRedeemTokenResponse;

    const accessToken = typeof result.accessToken === 'string' ? result.accessToken : result.accessToken.token;
    const refreshToken = typeof result.refreshToken === 'string' ? result.refreshToken : result.refreshToken.token;

    logger.debug(`Access token obtained: ${maskSensitiveData(accessToken)}`);
    logger.debug(`Refresh token obtained: ${maskSensitiveData(refreshToken)}`);

    // API KSeF zwraca tokeny jako obiekty { token, validUntil }.
    return Object.freeze<TTokensReturn>({
      accessToken,
      refreshToken,
    });
  } catch (error) {
    logger.error(`Błąd w redeemToken: ${(error as Error).message}`);
    if ((error as Error).stack) {
      logger.debug(`Stack trace: ${(error as Error).stack}`);
    }
    throw error;
  }
}

/**
 * Główna funkcja uwierzytelniania tokenem KSeF
 * @param {Object} config - Konfiguracja aplikacji
 * @returns {Promise<Object>} Obiekt z accessToken i refreshToken
 * @throws {Error} Gdy nie udało się uwierzytelnić
 */
export async function authenticate(config: IConfig): Promise<TTokensReturn> {
  try {
    logger.info('Starting authentication...');

    // 1. Wczytaj token KSeF z pliku
    const ksefToken = await loadKsefToken(config.tokenPath);
    logger.debug('KSeF token loaded from file');

    // 2. Pobierz klucz publiczny
    const publicKey = await getPublicKey(config);

    // 3. Pobierz challenge
    const { challenge, timestampMs } = await getChallenge(config.baseUrl);

    // 4. Zaszyfruj token
    const encryptedToken = encryptKsefToken(ksefToken, timestampMs, publicKey);
    logger.debug('Token encrypted successfully');

    // 5. Wyślij żądanie uwierzytelnienia
    const { authenticationToken, referenceNumber } = await submitKsefTokenAuth(
      {
        challenge,
        encryptedToken,
        nip: config.nip,
      },
      config.baseUrl,
    );

    // 6. Odpytuj o status
    await pollAuthStatus(referenceNumber, authenticationToken.token, config.baseUrl);

    // 7. Pobierz tokeny dostępowe
    const tokens = await redeemToken(authenticationToken.token, config.baseUrl);

    logger.info('Authentication successful');

    return tokens;
  } catch (error) {
    logger.error(`Błąd w authenticate: ${(error as Error).message}`);
    if ((error as Error).stack) {
      logger.debug(`Stack trace: ${(error as Error).stack}`);
    }
    throw error;
  }
}
