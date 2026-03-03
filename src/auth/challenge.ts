/**
 * Pobieranie challenge dla uwierzytelniania
 */
import { post, TIMEOUTS } from '../utils/http-client.ts';
import logger, { maskSensitiveData } from '../utils/logger.ts';

interface IChallengeResponse {
  challenge: string;
  timestampMs: number;
}

type TChallengeReturn = {
  readonly challenge: string;
  readonly timestampMs: number;
};

/**
 * Pobiera challenge z API KSeF
 * @param {string} baseUrl - Bazowy URL API KSeF
 * @returns {Promise<{challenge:string; timestampMs:number}>} Obiekt z challenge i timestampMs
 * @throws {Error} Gdy nie udało się pobrać challenge z API
 */
export async function getChallenge(baseUrl: string): Promise<TChallengeReturn> {
  try {
    const url = `${baseUrl}/v2/auth/challenge`;

    logger.debug(`Requesting challenge from ${url}`);

    const response = await post(url, {}, {}, TIMEOUTS.AUTH);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get challenge: HTTP ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as IChallengeResponse;

    logger.debug(`Challenge received: ${maskSensitiveData(data.challenge)}`);
    logger.debug(`Timestamp: ${data.timestampMs}`);

    return Object.freeze<TChallengeReturn>({
      challenge: data.challenge,
      timestampMs: data.timestampMs,
    });
  } catch (error: unknown) {
    const err = error as Error;
    logger.error(`Błąd w getChallenge: ${err.message}`);
    if (err.stack) {
      logger.debug(`Stack trace: ${err.stack}`);
    }
    throw error;
  }
}
