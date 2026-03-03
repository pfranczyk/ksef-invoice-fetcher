/**
 * System logowania z poziomami (INFO, DEBUG, WARN, ERROR)
 */
import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

/**
 * Maskuje wrażliwe dane (tokeny, klucze) do logowania
 * Pokazuje pierwsze 4 znaki, resztę zastępuje gwiazdkami
 * @param {string | null | undefined} sensitiveData - Dane wrażliwe (token, klucz, certyfikat)
 * @param {number} visibleChars - Liczba widocznych znaków na początku (domyślnie 4)
 * @returns {string} Zamaskowane dane
 */
export function maskSensitiveData(sensitiveData: string | null | undefined, visibleChars: number = 4): string {
  if (!sensitiveData) {
    return '(brak)';
  }

  if (sensitiveData.length <= visibleChars) {
    return '****';
  }

  const visible = sensitiveData.substring(0, visibleChars);
  const maskedLength = Math.min(sensitiveData.length - visibleChars, 20); // max 20 gwiazdek
  const masked = '*'.repeat(maskedLength);

  return `${visible}${masked}`;
}

/**
 * Niestandardowy format logów
 * Format: [2026-01-17 10:30:45] INFO: Message
 */
const customFormat = printf(({ level, message, timestamp }) => {
  return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
});

/**
 * Niestandardowy format logów z kolorami (dla konsoli)
 */
const coloredFormat = printf(({ level, message, timestamp }) => {
  return `[${timestamp}] ${level}: ${message}`;
});

/**
 * Opcje konfiguracji loggera
 */
export type TLoggerOptions = {
  readonly level?: 'debug' | 'info' | 'warn' | 'error';
};

/**
 * Tworzy i konfiguruje logger
 * @param {TLoggerOptions} options - Opcje konfiguracji
 * @returns {winston.Logger} Skonfigurowany logger
 */
export function createLogger(options: TLoggerOptions = {}): winston.Logger {
  const level = options.level || process.env.LOG_LEVEL || 'info';

  const logger = winston.createLogger({
    level,
    format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), customFormat),
    transports: [
      new winston.transports.Console({
        format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), coloredFormat),
      }),
    ],
  });

  return logger;
}

// Domyślny logger
const logger = createLogger();

export default logger;
