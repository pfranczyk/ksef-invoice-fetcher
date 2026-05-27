import { beforeEach, describe, expect, it, vi } from 'vitest';
import { intervalCmd } from '../interval.ts';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockEnv = vi.hoisted(() => ({
  readKsefConfigFile: vi.fn(),
  writeKsefConfigFile: vi.fn(),
  CONFIG_DEFAULTS: Object.freeze({
    TOKEN_REFRESH_MARGIN_MINUTES: 5,
    EXPORT_POLL_INTERVAL_SECONDS: 5,
    EXPORT_STATUS_MAX_WAIT_MINUTES: 0,
  }),
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

const CONFIG_WITHOUT_INTERVAL = Object.freeze({
  nip: '5252674798',
  environment: 'TEST' as const,
});

const CONFIG_WITH_INTERVAL = Object.freeze({
  ...CONFIG_WITHOUT_INTERVAL,
  exportPollIntervalSeconds: 30,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------
// intervalCmd
// --------------------------------------------------------------------------

describe('intervalCmd', () => {
  it('powinien wypisać wartość domyślną gdy pole nie jest ustawione w config', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_INTERVAL);

    await intervalCmd();

    expect(mockLogger.default.info).toHaveBeenCalledWith('exportPollIntervalSeconds: 5 s');
    expect(mockEnv.writeKsefConfigFile).not.toHaveBeenCalled();
  });

  it('powinien wypisać aktualną wartość z config gdy ustawiona', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITH_INTERVAL);

    await intervalCmd();

    expect(mockLogger.default.info).toHaveBeenCalledWith('exportPollIntervalSeconds: 30 s');
  });

  it('powinien zapisać nową wartość w config i potwierdzić w logu', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_INTERVAL);

    await intervalCmd('10');

    expect(mockEnv.writeKsefConfigFile).toHaveBeenCalledWith({
      ...CONFIG_WITHOUT_INTERVAL,
      exportPollIntervalSeconds: 10,
    });
    expect(mockLogger.default.info).toHaveBeenCalledWith('✓ Zapisano exportPollIntervalSeconds: 10 s');
  });

  it('powinien zaakceptować wartości brzegowe: 1 i 300', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_INTERVAL);

    await intervalCmd('1');
    expect(mockEnv.writeKsefConfigFile).toHaveBeenLastCalledWith({
      ...CONFIG_WITHOUT_INTERVAL,
      exportPollIntervalSeconds: 1,
    });

    await intervalCmd('300');
    expect(mockEnv.writeKsefConfigFile).toHaveBeenLastCalledWith({
      ...CONFIG_WITHOUT_INTERVAL,
      exportPollIntervalSeconds: 300,
    });
  });

  it('powinien rzucić błąd gdy wartość jest poniżej zakresu (0)', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_INTERVAL);

    await expect(intervalCmd('0')).rejects.toThrow('Niepoprawna wartość: "0"');
    expect(mockEnv.writeKsefConfigFile).not.toHaveBeenCalled();
  });

  it('powinien rzucić błąd gdy wartość jest powyżej zakresu (301)', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_INTERVAL);

    await expect(intervalCmd('301')).rejects.toThrow('Niepoprawna wartość: "301"');
  });

  it('powinien rzucić błąd gdy wartość nie jest liczbą całkowitą', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_INTERVAL);

    await expect(intervalCmd('5.5')).rejects.toThrow('Niepoprawna wartość: "5.5"');
  });

  it('powinien rzucić błąd gdy wartość nie jest liczbą', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_INTERVAL);

    await expect(intervalCmd('abc')).rejects.toThrow('Niepoprawna wartość: "abc"');
  });
});
