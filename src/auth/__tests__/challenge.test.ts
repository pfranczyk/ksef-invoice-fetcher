import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChallenge } from '../challenge.ts';

// --------------------------------------------------------------------------
// Mocki
// --------------------------------------------------------------------------

const mockFns = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('../../utils/http-client.ts', () => ({
  post: mockFns.post,
  TIMEOUTS: Object.freeze({ DEFAULT: 30000, AUTH: 60000 }),
}));

vi.mock('../../utils/logger.ts', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  maskSensitiveData: vi.fn((s: string) => s),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------
// getChallenge
// --------------------------------------------------------------------------

describe('getChallenge', () => {
  it('powinien zwrócić challenge i timestampMs gdy API odpowiada sukcesem', async () => {
    mockFns.post.mockResolvedValue({
      ok: true,
      json: async () => ({ challenge: 'abc123', timestampMs: 1700000000000 }),
    });

    const result = await getChallenge('https://api-test.ksef.mf.gov.pl');

    expect(result).toEqual({ challenge: 'abc123', timestampMs: 1700000000000 });
    expect(mockFns.post).toHaveBeenCalledWith('https://api-test.ksef.mf.gov.pl/v2/auth/challenge', {}, {}, 60000);
  });

  it('powinien rzucić błąd gdy HTTP odpowiedź nie jest OK', async () => {
    mockFns.post.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    await expect(getChallenge('https://api-test.ksef.mf.gov.pl')).rejects.toThrow(
      'Failed to get challenge: HTTP 503 - Service Unavailable',
    );
  });

  it('powinien rzucić błąd gdy post rzuca wyjątek sieciowy', async () => {
    mockFns.post.mockRejectedValue(new Error('connection refused'));

    await expect(getChallenge('https://api-test.ksef.mf.gov.pl')).rejects.toThrow('connection refused');
  });
});
