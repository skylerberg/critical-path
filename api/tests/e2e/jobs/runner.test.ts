import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';
import { db } from '../../../src/db/index';
import {
  BACKOFF_SECONDS,
  CLAIM_BATCH,
  MAX_ATTEMPTS,
  MAX_CONCURRENT_JOBS,
  PERIODIC_MAX_BACKOFF_SECONDS,
  claimDueJobs,
  enqueueJob,
  failedJobCount,
  periodicJobs,
  recordJobFailure,
  registerJobHandler,
  registeredJobKinds,
  resetJobHandlers,
  reportJobBacklog,
  runDueJobs,
  runJobMaintenance,
  syncPeriodicJobs,
  unregisterJobHandler,
  unregisteredKindBacklog,
  type EnqueueJobOptions,
  type JobRow,
} from '../../../src/services/jobs/index';
import type { DB, JsonValue } from '../../../src/db/types';
import { logger } from '../../../src/utils/logger';

// The payload catalogue is a production guarantee: every kind the app enqueues
// has a row in it, and both entry points are generic over its keys. What this
// file covers is the queue underneath — claiming, leasing, backoff, schedules —
// which is kind-agnostic on purpose, so it drives that with synthetic kinds that
// deliberately have no row.
const register = registerJobHandler as unknown as (handler: {
  kind: string;
  timeoutMs: number;
  intervalSeconds?: number;
  run: (payload: JsonValue) => Promise<void>;
}) => void;

const enqueue = enqueueJob as unknown as (
  connection: Kysely<DB>,
  kind: string,
  payload: JsonValue,
  options?: EnqueueJobOptions
) => Promise<string>;

function jobRow(kind: string): Promise<JobRow> {
  return db.selectFrom('job').selectAll().where('kind', '=', kind).executeTakeFirstOrThrow();
}

function jobRows(kind: string): Promise<JobRow[]> {
  return db.selectFrom('job').selectAll().where('kind', '=', kind).execute();
}

// Every retry path here backs off by design; pulling run_at back is how the
// next attempt is reached without waiting the real interval.
async function makeDue(kind: string): Promise<void> {
  await db.updateTable('job').set({ run_at: new Date() }).where('kind', '=', kind).execute();
}

// Counting rows and claiming due work are both table-wide, so this file owns
// the queue outright. afterEach alone left the first test reading whatever an
// earlier file's post-commit hooks had enqueued — invisible in the default file
// order, and a failure as soon as sharding or a new file changes it.
beforeAll(async () => {
  await db.deleteFrom('job').execute();
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetJobHandlers();
  await db.deleteFrom('job').execute();
});

describe('enqueueJob', () => {
  it('queues nothing when the transaction that enqueued it rolls back', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await enqueue(trx, 'test_rollback', { task_id: 'abc' });
        throw new Error('caller failed after enqueue');
      })
    ).rejects.toThrow('caller failed after enqueue');

    expect(await jobRows('test_rollback')).toHaveLength(0);
  });

  it('queues the job when that transaction commits', async () => {
    const id = await db
      .transaction()
      .execute((trx) => enqueue(trx, 'test_commit', { task_id: 'abc' }));

    const row = await db
      .selectFrom('job')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.kind).toBe('test_commit');
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.interval_seconds).toBeNull();
  });

  it('refuses a payload carrying contact details and writes nothing', async () => {
    await expect(enqueue(db, 'test_pii', { to: 'someone@example.com' })).rejects.toThrow(
      /email address/
    );
    await expect(enqueue(db, 'test_pii', { recipient: { email: null } })).rejects.toThrow(
      /contact field/
    );
    expect(await jobRows('test_pii')).toHaveLength(0);
  });
});

describe('claimDueJobs', () => {
  it('leases a claimed job so a second claim cannot take it', async () => {
    await enqueue(db, 'test_leased', {});

    const first = await claimDueJobs(['test_leased'], 10);
    expect(first).toHaveLength(1);
    expect(first[0].attempts).toBe(1);

    expect(await claimDueJobs(['test_leased'], 10)).toHaveLength(0);
  });
});

describe('runDueJobs', () => {
  it('runs a one-shot job once and deletes the row', async () => {
    const seen: unknown[] = [];
    register({
      kind: 'test_once',
      timeoutMs: 1000,
      run: (payload) => {
        seen.push(payload);
        return Promise.resolve();
      },
    });
    await enqueue(db, 'test_once', { task_id: 'abc' });

    expect(await runDueJobs()).toBe(1);
    expect(seen).toEqual([{ task_id: 'abc' }]);
    expect(await jobRows('test_once')).toHaveLength(0);
    expect(await runDueJobs()).toBe(0);
  });

  it('does not claim a job before its run_at', async () => {
    let runs = 0;
    register({
      kind: 'test_deferred',
      timeoutMs: 1000,
      run: () => {
        runs += 1;
        return Promise.resolve();
      },
    });
    await enqueue(db, 'test_deferred', {}, { runAt: new Date(Date.now() + 60_000) });

    expect(await runDueJobs()).toBe(0);
    expect(runs).toBe(0);
  });

  it('leaves a kind this process has no handler for untouched', async () => {
    register({ kind: 'test_current_release', timeoutMs: 1000, run: () => Promise.resolve() });
    await enqueue(db, 'test_current_release', {});
    await enqueue(db, 'test_future_release', {});

    expect(await runDueJobs()).toBe(1);

    const orphan = await jobRow('test_future_release');
    expect(orphan.attempts).toBe(0);
    expect(orphan.status).toBe('pending');
  });

  it('backs a failing one-shot job off instead of retrying it immediately', async () => {
    register({
      kind: 'test_backoff',
      timeoutMs: 1000,
      run: () => Promise.reject(new Error('handler blew up')),
    });
    await enqueue(db, 'test_backoff', {});

    expect(await runDueJobs()).toBe(1);

    const row = await jobRow('test_backoff');
    expect(row.status).toBe('pending');
    expect(row.last_error).toBe('handler blew up');
    expect(row.run_at.getTime()).toBeGreaterThan(Date.now() + (BACKOFF_SECONDS[0] - 5) * 1000);
    expect(await runDueJobs()).toBe(0);
  });

  it('retires a one-shot job after the last attempt and keeps the row', async () => {
    register({
      kind: 'test_poison',
      timeoutMs: 1000,
      run: () => Promise.reject(new Error('handler blew up')),
    });
    await enqueue(db, 'test_poison', {});

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      expect(await runDueJobs()).toBe(1);
      const row = await jobRow('test_poison');
      expect(row.attempts).toBe(attempt);
      expect(row.status).toBe(attempt < MAX_ATTEMPTS ? 'pending' : 'failed');
      await makeDue('test_poison');
    }

    expect(await failedJobCount()).toBe(1);
    expect(await runDueJobs()).toBe(0);
    expect((await jobRow('test_poison')).last_error).toBe('handler blew up');
  });

  it('claims a whole batch but runs only the concurrency limit at a time', async () => {
    let live = 0;
    let peak = 0;
    // Gated rather than slept through: a fixed sleep only overlaps the handlers
    // if the loop schedules them inside it, so on a slow or contended machine
    // `peak` could come up short of the limit for no real reason. Holding the
    // first arrivals until the limit is reached asserts the same cap without
    // depending on timing; CLAIM_BATCH exceeds the limit, so enough handlers
    // always arrive to open the gate.
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    register({
      kind: 'test_burst',
      timeoutMs: 1000,
      run: async () => {
        live += 1;
        peak = Math.max(peak, live);
        if (live >= MAX_CONCURRENT_JOBS) release();
        await gate;
        live -= 1;
      },
    });
    for (let i = 0; i < CLAIM_BATCH + 4; i++) await enqueue(db, 'test_burst', {});

    expect(await runDueJobs()).toBe(CLAIM_BATCH);
    expect(peak).toBe(MAX_CONCURRENT_JOBS);
    expect(await jobRows('test_burst')).toHaveLength(4);
  });

  it('starts nothing more while the handlers of an overrunning tick still hold the slots', async () => {
    let live = 0;
    let peak = 0;
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    register({
      kind: 'test_overlap',
      timeoutMs: 10_000,
      run: async () => {
        live += 1;
        peak = Math.max(peak, live);
        await gate;
        live -= 1;
      },
    });
    for (let i = 0; i < CLAIM_BATCH + 4; i++) await enqueue(db, 'test_overlap', {});

    const overrunning = runDueJobs();
    try {
      await vi.waitFor(() => expect(live).toBe(MAX_CONCURRENT_JOBS));

      expect(await runDueJobs()).toBe(0);
      expect(peak).toBe(MAX_CONCURRENT_JOBS);
    } finally {
      release();
      await overrunning;
    }
    expect(await overrunning).toBe(CLAIM_BATCH);
  });

  it('records a failure for a row whose handler went away after the claim', async () => {
    register({
      kind: 'test_unregisters',
      timeoutMs: 1000,
      run: () => {
        unregisterJobHandler('test_vanished');
        return Promise.resolve();
      },
    });
    register({ kind: 'test_vanished', timeoutMs: 1000, run: () => Promise.resolve() });
    await enqueue(db, 'test_unregisters', {}, { runAt: new Date(Date.now() - 1000) });
    await enqueue(db, 'test_vanished', {});

    expect(await runDueJobs()).toBe(2);

    const row = await jobRow('test_vanished');
    expect(row.attempts).toBe(1);
    expect(row.status).toBe('pending');
    expect(row.last_error).toBe('No handler registered for kind test_vanished');
  });

  it('fails the job rather than the tick when a payload does not match its kind', async () => {
    let runs = 0;
    register({
      kind: 'attachment_unfurl',
      timeoutMs: 1000,
      run: () => {
        runs += 1;
        return Promise.resolve();
      },
    });
    await enqueue(db, 'attachment_unfurl', { attachment_id: 7 });

    expect(await runDueJobs()).toBe(1);

    expect(runs).toBe(0);
    const row = await jobRow('attachment_unfurl');
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain('does not match kind attachment_unfurl');
  });

  it('gives up on a handler that overruns its timeout and records the failure', async () => {
    register({ kind: 'test_slow', timeoutMs: 50, run: () => new Promise<void>(() => undefined) });
    await enqueue(db, 'test_slow', {});

    expect(await runDueJobs()).toBe(1);

    const row = await jobRow('test_slow');
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain('exceeded 50ms');
  });
});

describe('periodic jobs', () => {
  it('reschedules at its interval and clears the attempt count', async () => {
    let runs = 0;
    register({
      kind: 'test_sweep',
      timeoutMs: 1000,
      intervalSeconds: 60,
      run: () => {
        runs += 1;
        return Promise.resolve();
      },
    });
    await syncPeriodicJobs(periodicJobs(), registeredJobKinds());

    expect(await runDueJobs()).toBe(1);
    expect(runs).toBe(1);

    const row = await jobRow('test_sweep');
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBeNull();
    expect(row.run_at.getTime()).toBeGreaterThan(Date.now() + 50_000);
    expect(await runDueJobs()).toBe(0);
  });

  it('is never retired however often it fails, and caps its backoff', async () => {
    register({
      kind: 'test_sweep_broken',
      timeoutMs: 1000,
      intervalSeconds: 60,
      run: () => Promise.reject(new Error('sweep blew up')),
    });
    await syncPeriodicJobs(periodicJobs(), registeredJobKinds());

    for (let attempt = 1; attempt <= MAX_ATTEMPTS + 2; attempt++) {
      expect(await runDueJobs()).toBe(1);
      const row = await jobRow('test_sweep_broken');
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(attempt);
      expect(row.last_error).toBe('sweep blew up');
      expect(row.run_at.getTime()).toBeLessThanOrEqual(
        Date.now() + PERIODIC_MAX_BACKOFF_SECONDS * 1000
      );
      await makeDue('test_sweep_broken');
    }

    expect(await failedJobCount()).toBe(0);
  });

  it('keeps one row per kind and adopts a changed interval without moving run_at', async () => {
    await syncPeriodicJobs([{ kind: 'test_schedule', intervalSeconds: 60 }], ['test_schedule']);
    const seeded = await jobRow('test_schedule');

    const parked = new Date(Date.now() + 3_600_000);
    await db.updateTable('job').set({ run_at: parked }).where('id', '=', seeded.id).execute();

    await syncPeriodicJobs([{ kind: 'test_schedule', intervalSeconds: 300 }], ['test_schedule']);

    const rows = await jobRows('test_schedule');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(seeded.id);
    expect(rows[0].interval_seconds).toBe(300);
    expect(rows[0].run_at.getTime()).toBe(parked.getTime());
  });

  it('retires the schedule of a kind this process handles but no longer schedules', async () => {
    await syncPeriodicJobs([{ kind: 'test_dropped', intervalSeconds: 60 }], ['test_dropped']);
    expect(await jobRows('test_dropped')).toHaveLength(1);

    await syncPeriodicJobs([], ['test_dropped']);

    expect(await jobRows('test_dropped')).toHaveLength(0);
  });

  it('leaves the schedule of a kind this process knows nothing about', async () => {
    await syncPeriodicJobs(
      [{ kind: 'test_other_release', intervalSeconds: 60 }],
      ['test_other_release']
    );

    await syncPeriodicJobs([], []);

    expect(await jobRows('test_other_release')).toHaveLength(1);
  });

  it('retires only the schedule, never a queued one-shot of the same kind', async () => {
    await syncPeriodicJobs([{ kind: 'test_mixed', intervalSeconds: 60 }], ['test_mixed']);
    await enqueue(db, 'test_mixed', { task_id: 'abc' });

    await syncPeriodicJobs([], ['test_mixed']);

    const rows = await jobRows('test_mixed');
    expect(rows).toHaveLength(1);
    expect(rows[0].interval_seconds).toBeNull();
  });
});

describe('unregisteredKindBacklog', () => {
  it('counts pending rows whose kind nothing in this process handles', async () => {
    register({ kind: 'test_known', timeoutMs: 1000, run: () => Promise.resolve() });
    await enqueue(db, 'test_known', {});
    await enqueue(db, 'test_orphan', {});
    await enqueue(db, 'test_orphan', {});
    const retired = await enqueue(db, 'test_orphan', {});
    await db.updateTable('job').set({ status: 'failed' }).where('id', '=', retired).execute();

    expect(await unregisteredKindBacklog(registeredJobKinds())).toEqual([
      { kind: 'test_orphan', count: 2 },
    ]);
  });

  it('counts every pending kind when this process registered none', async () => {
    await enqueue(db, 'test_a', {});
    await enqueue(db, 'test_b', {});

    const backlog = await unregisteredKindBacklog([]);

    expect([...backlog].sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { kind: 'test_a', count: 1 },
      { kind: 'test_b', count: 1 },
    ]);
  });
});

describe('recordJobFailure', () => {
  it('backs a row off from the first step when the caller never claimed it', async () => {
    await enqueue(db, 'test_unclaimed', {});
    const row = await jobRow('test_unclaimed');
    expect(row.attempts).toBe(0);

    await recordJobFailure(row, 'recorded outside the runner');

    const after = await jobRow('test_unclaimed');
    expect(after.last_error).toBe('recorded outside the runner');
    expect(after.run_at.getTime()).toBeGreaterThan(Date.now() + (BACKOFF_SECONDS[0] - 5) * 1000);
  });
});

describe('reportJobBacklog', () => {
  it('warns about pending kinds nothing handles and rows parked in failed', async () => {
    const warnings = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    register({ kind: 'test_handled', timeoutMs: 1000, run: () => Promise.resolve() });
    await enqueue(db, 'test_handled', {});
    await enqueue(db, 'test_stranded', {});
    const parked = await enqueue(db, 'test_handled', {});
    await db.updateTable('job').set({ status: 'failed' }).where('id', '=', parked).execute();

    await reportJobBacklog();

    expect(warnings).toHaveBeenCalledWith({
      msg: 'Pending jobs have no handler in this process',
      kind: 'test_stranded',
      count: 1,
    });
    expect(warnings).toHaveBeenCalledWith({ msg: 'Jobs are parked in failed state', count: 1 });
  });

  it('says nothing when every pending row has a handler and none are parked', async () => {
    const warnings = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    register({ kind: 'test_handled', timeoutMs: 1000, run: () => Promise.resolve() });
    await enqueue(db, 'test_handled', {});

    await reportJobBacklog();

    expect(warnings).not.toHaveBeenCalled();
  });
});

describe('runJobMaintenance', () => {
  it('seeds the schedules the registered handlers declare and reports the backlog', async () => {
    const warnings = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    register({
      kind: 'test_boot_sweep',
      timeoutMs: 1000,
      intervalSeconds: 60,
      run: () => Promise.resolve(),
    });
    await enqueue(db, 'test_boot_stranded', {});

    await runJobMaintenance();

    const seeded = await jobRows('test_boot_sweep');
    expect(seeded).toHaveLength(1);
    expect(seeded[0].interval_seconds).toBe(60);
    expect(warnings).toHaveBeenCalledWith({
      msg: 'Pending jobs have no handler in this process',
      kind: 'test_boot_stranded',
      count: 1,
    });
  });
});
