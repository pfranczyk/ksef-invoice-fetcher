import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from '../sleep.ts';

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('powinien rozwiązać promise po podanej liczbie milisekund', async () => {
    const promise = sleep(1000);

    vi.advanceTimersByTime(1000);

    await expect(promise).resolves.toBeUndefined();
  });

  it('nie powinien rozwiązać promise przed upływem czasu', async () => {
    let resolved = false;
    sleep(1000).then(() => {
      resolved = true;
    });

    vi.advanceTimersByTime(999);
    await Promise.resolve(); // flush microtasks

    expect(resolved).toBe(false);
  });

  it('powinien rozwiązać promise natychmiast gdy ms wynosi 0', async () => {
    const promise = sleep(0);

    vi.advanceTimersByTime(0);

    await expect(promise).resolves.toBeUndefined();
  });
});
