import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initCmd } from '../init.ts';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:fs', () => mockFs);

const mockEnv = vi.hoisted(() => ({
  getKsefDir: vi.fn(),
  writeKsefConfigFile: vi.fn(),
}));

vi.mock('../../config/env.ts', () => mockEnv);

const mockLogger = vi.hoisted(() => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskSensitiveData: vi.fn((s: string) => s),
}));

vi.mock('../../utils/logger.ts', () => mockLogger);

// --------------------------------------------------------------------------
// Stałe
// --------------------------------------------------------------------------

const VALID_NIP = '5252674798';
const KSEF_DIR = '/cwd/.ksef';
const TOKEN_PATH = resolve(KSEF_DIR, 'ksef.token');
const README_PATH = resolve(KSEF_DIR, 'README.txt');

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.getKsefDir.mockReturnValue(KSEF_DIR);
  mockFs.existsSync.mockReturnValue(false);
});

// --------------------------------------------------------------------------
// initCmd
// --------------------------------------------------------------------------

describe('initCmd', () => {
  it('powinien utworzyć katalog .ksef/ i zapisać config.json z domyślnym środowiskiem PRD', async () => {
    await initCmd(VALID_NIP);

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(KSEF_DIR, { recursive: true });
    expect(mockEnv.writeKsefConfigFile).toHaveBeenCalledWith({ nip: VALID_NIP, environment: 'PRD' });
  });

  it('powinien zapisać environment DEMO gdy podano "demo" (case-insensitive)', async () => {
    await initCmd(VALID_NIP, 'demo');

    expect(mockEnv.writeKsefConfigFile).toHaveBeenCalledWith({ nip: VALID_NIP, environment: 'DEMO' });
  });

  it('powinien utworzyć pusty plik ksef.token gdy nie istnieje', async () => {
    await initCmd(VALID_NIP, 'TEST');

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(TOKEN_PATH, '', 'utf-8');
  });

  it('powinien pominąć ksef.token gdy plik już istnieje', async () => {
    mockFs.existsSync.mockImplementation((path: string) => path === TOKEN_PATH);

    await initCmd(VALID_NIP, 'TEST');

    const writeCalls = mockFs.writeFileSync.mock.calls.map((c) => c[0]);
    expect(writeCalls).not.toContain(TOKEN_PATH);
  });

  it('powinien utworzyć README.txt w katalogu .ksef/', async () => {
    await initCmd(VALID_NIP, 'TEST');

    const writeCalls = mockFs.writeFileSync.mock.calls.map((c) => c[0]);
    expect(writeCalls).toContain(README_PATH);
  });

  it('powinien wypisać ostrzeżenie produkcyjne gdy environment to PRD', async () => {
    await initCmd(VALID_NIP, 'PRD');

    const warnCalls = mockLogger.default.warn.mock.calls.map((c) => c[0]);
    expect(warnCalls).toContain('UWAGA: środowisko PRODUKCYJNE KSeF');
  });

  it('nie powinien wypisać ostrzeżenia produkcyjnego gdy environment to DEMO', async () => {
    await initCmd(VALID_NIP, 'DEMO');

    expect(mockLogger.default.warn).not.toHaveBeenCalled();
  });

  it('powinien rzucić błąd gdy NIP ma błędną sumę kontrolną i nie zapisać konfiguracji', async () => {
    await expect(initCmd('5252674799', 'TEST')).rejects.toThrow('Nieprawidłowa suma kontrolna');

    expect(mockEnv.writeKsefConfigFile).not.toHaveBeenCalled();
    expect(mockFs.mkdirSync).not.toHaveBeenCalled();
  });

  it('powinien rzucić błąd gdy środowisko jest niepoprawne', async () => {
    await expect(initCmd(VALID_NIP, 'STAGING')).rejects.toThrow('Niepoprawne środowisko');

    expect(mockEnv.writeKsefConfigFile).not.toHaveBeenCalled();
  });
});
