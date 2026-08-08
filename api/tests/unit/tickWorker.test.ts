import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWorker } from '../../src/services/tickWorker';
import { logger } from '../../src/utils/logger';

// The worker is an interval plus a budget timeout, so fake timers let each
// step run deterministically instead of waiting out real delays.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('startWorker', () => {
  it('never runs two ticks at once', async () => {
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = startWorker({
      name: 'Test',
      tickMs: 5,
      budgetMs: 10_000,
      tick: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await hold;
        active -= 1;
      },
    });

    // The first interval starts a tick that parks on `hold`; the next two
    // intervals find the worker still busy and are skipped.
    await vi.advanceTimersByTimeAsync(5);
    expect(peak).toBe(1);
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(5);
    expect(peak).toBe(1);

    release();
    worker.close();
  });

  it('reports a tick that overruns its budget and keeps ticking', async () => {
    const errors = vi.spyOn(logger, 'error').mockImplementation(() => {});
    let ticks = 0;
    const worker = startWorker({
      name: 'Test',
      tickMs: 5,
      budgetMs: 20,
      tick: () => {
        ticks += 1;
        return new Promise<void>(() => undefined);
      },
    });

    // The first tick never resolves; its 20ms budget then fires and rejects.
    await vi.advanceTimersByTimeAsync(5);
    expect(ticks).toBe(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(errors).toHaveBeenCalledWith({
      msg: 'Test worker tick failed',
      error: 'Tick exceeded 20ms',
    });

    // The latch clears once the overrun is logged, so later intervals start
    // fresh ticks again.
    await vi.advanceTimersByTimeAsync(30);
    expect(ticks).toBeGreaterThan(1);

    worker.close();
  });

  it('reports a failing tick and keeps ticking', async () => {
    const errors = vi.spyOn(logger, 'error').mockImplementation(() => {});
    let ticks = 0;
    const worker = startWorker({
      name: 'Test',
      tickMs: 5,
      budgetMs: 10_000,
      tick: () => {
        ticks += 1;
        return Promise.reject(new Error('tick blew up'));
      },
    });

    await vi.advanceTimersByTimeAsync(5);
    expect(ticks).toBe(1);
    expect(errors).toHaveBeenCalledWith({
      msg: 'Test worker tick failed',
      error: 'tick blew up',
    });

    await vi.advanceTimersByTimeAsync(5);
    expect(ticks).toBe(2);

    worker.close();
  });

  it('stops ticking once closed', async () => {
    let ticks = 0;
    const worker = startWorker({
      name: 'Test',
      tickMs: 5,
      budgetMs: 10_000,
      tick: () => {
        ticks += 1;
        return Promise.resolve();
      },
    });

    await vi.advanceTimersByTimeAsync(30);
    expect(ticks).toBeGreaterThan(1);
    worker.close();

    const atClose = ticks;
    await vi.advanceTimersByTimeAsync(30);
    expect(ticks).toBe(atClose);
  });
});
