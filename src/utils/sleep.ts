/**
 * Funkcja pomocnicza do opóżnienia (sleep)
 * @param {number} ms - Czas w milisekundach
 * @returns {Promise<void>}
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
