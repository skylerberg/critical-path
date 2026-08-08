import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWorker } from '../../src/services/tickWorker';
import { logger } from '../../src/utils/logger';

const delay = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startWorker', () => {
  it('never runs two ticks at once', async () => {
    let ticks = 0;
    let live = 0;
    let peak = 0;
    const worker = startWorker({
      name: 'Test',
      tickMs: 5,
      budgetMs: 10_000,
      tick: async () => {
        ticks += 1;
        live += 1;
        peak = Math.max(peak, live);
        await delay(40);
        live -= 1;
      },
    });

    await delay(200);
    worker.close();

    expect(ticks).toBeGreaterThan(1);
    expect(peak).toBe(1);
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

    await delay(200);
    worker.close();

    expect(ticks).toBeGreaterThan(1);
    expect(errors).toHaveBeenCalledWith({
      msg: 'Test worker tick failed',
      error: 'Tick exceeded 20ms',
    });
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

    await delay(100);
    worker.close();

    expect(ticks).toBeGreaterThan(1);
    expect(errors).toHaveBeenCalledWith({ msg: 'Test worker tick failed', error: 'tick blew up' });
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

    await delay(60);
    worker.close();
    const atClose = ticks;
    await delay(60);

    expect(atClose).toBeGreaterThan(1);
    expect(ticks).toBe(atClose);
  });
});
