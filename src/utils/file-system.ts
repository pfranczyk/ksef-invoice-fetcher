/**
 * Operacje na systemie plików
 */
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Sprawdza czy plik istnieje
 * @param {string} filePath - Ścieżka do pliku
 * @returns {Promise<boolean>} true jeśli plik istnieje
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wczytuje zawartość pliku jako tekst
 * @param {string} filePath - Ścieżka do pliku
 * @returns {Promise<string>} Zawartość pliku
 * @throws {Error} Gdy nie udało się odczytać pliku
 */
export async function readFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

/**
 * Zapisuje tekst do pliku
 * @param {string} filePath - Ścieżka do pliku
 * @param {string} content - Zawartość do zapisania
 * @param {number} [mode] - Opcjonalne uprawnienia pliku (np. 0o600). Na Windows no-op.
 * @returns {Promise<void>}
 * @throws {Error} Gdy nie udało się zapisać pliku
 */
export async function writeFile(filePath: string, content: string, mode?: number): Promise<void> {
  // Utwórz katalog jeśli nie istnieje
  const dir = dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(filePath, content, { encoding: 'utf-8', mode });
}

/**
 * Zapisuje dane binarne do pliku
 * @param {string} filePath - Ścieżka do pliku
 * @param {Buffer} data - Dane binarne
 * @returns {Promise<void>}
 * @throws {Error} Gdy nie udało się zapisać pliku
 */
export async function writeBinaryFile(filePath: string, data: Buffer): Promise<void> {
  const dir = dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(filePath, data);
}

/**
 * Usuwa plik
 * @param {string} filePath - Ścieżka do pliku
 * @returns {Promise<void>}
 */
export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error: unknown) {
    // Ignoruj błąd jeśli plik nie istnieje
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Usuwa katalog rekursywnie
 * @param {string} dirPath - Ścieżka do katalogu
 * @returns {Promise<void>}
 */
export async function deleteDirectory(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Tworzy katalog rekursywnie
 * @param {string} dirPath - Ścieżka do katalogu
 * @returns {Promise<void>}
 * @throws {Error} Gdy nie udało się utworzyć katalogu
 */
export async function createDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Wczytuje plik JSON
 * @param {string} filePath - Ścieżka do pliku
 * @returns {Promise<unknown>} Sparsowany obiekt JSON
 * @throws {Error} Gdy nie udało się odczytać lub sparsować pliku
 */
export async function readJsonFile(filePath: string): Promise<unknown> {
  const content = await readFile(filePath);
  return JSON.parse(content);
}

/**
 * Zapisuje obiekt jako JSON do pliku
 * @param {string} filePath - Ścieżka do pliku
 * @param {unknown} data - Obiekt do zapisania
 * @param {number} [mode] - Opcjonalne uprawnienia pliku (np. 0o600). Na Windows no-op.
 * @returns {Promise<void>}
 * @throws {Error} Gdy nie udało się zapisać pliku
 */
export async function writeJsonFile(filePath: string, data: unknown, mode?: number): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await writeFile(filePath, content, mode);
}
