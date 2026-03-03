/**
 * Typy konfiguracji aplikacji KSeF
 */

/**
 * Typ środowiska KSeF
 */
export type TEnvironment = 'DEMO' | 'TEST' | 'PRD';

/**
 * Interfejs głównej konfiguracji aplikacji
 */
export interface IConfig {
  readonly env: TEnvironment;
  readonly baseUrl: string;
  readonly certPath: string;
  readonly certKeyPath: string;
  readonly certPassword: string;
  readonly tokenPath: string;
  readonly publicKeyPath: string;
  readonly nip: string;
  readonly outputDir: string;
  readonly tempDir: string;
  readonly templatePath: string | null;
  readonly tokenStoragePath: string;
  readonly tokenRefreshMarginMinutes: number;
  readonly exportPollIntervalSeconds: number;
  readonly exportStatusMaxWaitMinutes: number;
  readonly libreOfficePath: string | null;
}

/**
 * Typ mapowania środowisk na URL-e API
 */
export type TApiUrls = {
  readonly DEMO: string;
  readonly TEST: string;
  readonly PRD: string;
};

// ============================================================================
// Typy wspólne dla modułu invoices
// ============================================================================

/**
 * Interfejs loggera używany w całym module invoices
 */
export interface ILogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Informacje o pojedynczej części paczki eksportu
 */
export interface IPackagePart {
  ordinalNumber: number;
  url: string;
  method: string;
  partSize: number;
  encryptedPartHash?: string;
  partHash?: string;
  expirationDate?: string;
}

/**
 * Informacje o paczce eksportu z API
 */
export interface IPackageInfo {
  invoiceCount: number;
  size: number;
  isTruncated?: boolean;
  parts: IPackagePart[];
}
