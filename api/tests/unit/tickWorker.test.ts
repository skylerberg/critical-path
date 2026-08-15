import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWorker } from '../../src/services/tickWorker';
import { startJobWorker } from '../../src/services/jobs/worker';
import { registerJobHandler, resetJobHandlers } from '../../src/services/jobs/handlers';
import { logger } from '../../src/utils/logger';

// The job tick calls runJobMaintenance and runDueJobs from inside their own
// module, where no spy can see them; the queue functions each one reaches are
// the closest observable thing, and stubbing them keeps this file off a database.
const queue = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('../../src/services/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/jobs/queue')>();
  return {
    ...actual,
    syncPeriodicJobs: () => {
      queue.calls.push('maintenance');
      return Promise.resolve();
    },
    unregisteredKindBacklog: () => Promise.resolve([]),
    failedJobCount: () => Promise.resolve(0),
    claimDueJobs: () => {
      queue.calls.push('claim');
      return Promise.resolve([]);
    },
  };
});

// Both are private to the job worker, and restating them is the point: a
// cadence the tests recompute from the module under test pins nothing.
const JOB_TICK_MS = 5_000;
const MAINTENANCE_EVERY_TICKS = 60;

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

describe('startJobWorker', () => {
  const called = (name: string): number => queue.calls.filter((call) => call === name).length;

  beforeEach(() => {
    queue.calls = [];
    // A process holding no handler claims nothing at all, so the claim would go
    // unmade for a reason that has nothing to do with the tick.
    registerJobHandler({
      kind: 'attachment_unfurl',
      timeoutMs: 1000,
      run: () => Promise.resolve(),
    });
  });

  afterEach(() => {
    resetJobHandlers();
  });

  it('seeds the schedules before it claims anything on its first tick', async () => {
    const worker = startJobWorker();

    await vi.advanceTimersByTimeAsync(JOB_TICK_MS);
    worker.close();

    expect(queue.calls).toEqual(['maintenance', 'claim']);
  });

  it('claims on every tick and repeats maintenance only every sixtieth', async () => {
    const worker = startJobWorker();

    for (let tick = 0; tick < MAINTENANCE_EVERY_TICKS; tick++) {
      await vi.advanceTimersByTimeAsync(JOB_TICK_MS);
    }

    expect(called('claim')).toBe(MAINTENANCE_EVERY_TICKS);
    expect(called('maintenance')).toBe(1);

    await vi.advanceTimersByTimeAsync(JOB_TICK_MS);
    worker.close();

    expect(called('claim')).toBe(MAINTENANCE_EVERY_TICKS + 1);
    expect(called('maintenance')).toBe(2);
  });
});
