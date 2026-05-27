import { beforeEach, describe, expect, it, vi } from 'vitest';
import { marginCmd } from '../margin.ts';

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

const CONFIG_WITHOUT_MARGIN = Object.freeze({
  nip: '5252674798',
  environment: 'TEST' as const,
});

const CONFIG_WITH_MARGIN = Object.freeze({
  ...CONFIG_WITHOUT_MARGIN,
  tokenRefreshMarginMinutes: 15,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------
// marginCmd
// --------------------------------------------------------------------------

describe('marginCmd', () => {
  it('powinien wypisać wartość domyślną gdy pole nie jest ustawione w config', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_MARGIN);

    await marginCmd();

    expect(mockLogger.default.info).toHaveBeenCalledWith('tokenRefreshMarginMinutes: 5 min');
    expect(mockEnv.writeKsefConfigFile).not.toHaveBeenCalled();
  });

  it('powinien wypisać aktualną wartość z config gdy ustawiona', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITH_MARGIN);

    await marginCmd();

    expect(mockLogger.default.info).toHaveBeenCalledWith('tokenRefreshMarginMinutes: 15 min');
  });

  it('powinien zapisać nową wartość w config i potwierdzić w logu', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_MARGIN);

    await marginCmd('10');

    expect(mockEnv.writeKsefConfigFile).toHaveBeenCalledWith({
      ...CONFIG_WITHOUT_MARGIN,
      tokenRefreshMarginMinutes: 10,
    });
    expect(mockLogger.default.info).toHaveBeenCalledWith('✓ Zapisano tokenRefreshMarginMinutes: 10 min');
  });

  it('powinien zaakceptować wartości brzegowe: 0 i 60', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_MARGIN);

    await marginCmd('0');
    expect(mockEnv.writeKsefConfigFile).toHaveBeenLastCalledWith({
      ...CONFIG_WITHOUT_MARGIN,
      tokenRefreshMarginMinutes: 0,
    });

    await marginCmd('60');
    expect(mockEnv.writeKsefConfigFile).toHaveBeenLastCalledWith({
      ...CONFIG_WITHOUT_MARGIN,
      tokenRefreshMarginMinutes: 60,
    });
  });

  it('powinien rzucić błąd gdy wartość jest powyżej zakresu', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_MARGIN);

    await expect(marginCmd('61')).rejects.toThrow('Niepoprawna wartość: "61"');
    expect(mockEnv.writeKsefConfigFile).not.toHaveBeenCalled();
  });

  it('powinien rzucić błąd gdy wartość jest ujemna', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_MARGIN);

    await expect(marginCmd('-1')).rejects.toThrow('Niepoprawna wartość: "-1"');
  });

  it('powinien rzucić błąd gdy wartość nie jest liczbą całkowitą', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_MARGIN);

    await expect(marginCmd('5.5')).rejects.toThrow('Niepoprawna wartość: "5.5"');
  });

  it('powinien rzucić błąd gdy wartość nie jest liczbą', async () => {
    mockEnv.readKsefConfigFile.mockReturnValue(CONFIG_WITHOUT_MARGIN);

    await expect(marginCmd('abc')).rejects.toThrow('Niepoprawna wartość: "abc"');
  });
});
