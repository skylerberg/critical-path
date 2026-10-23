import { errorText } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { startWorker } from '../tickWorker';
import {
  jobHandler,
  periodicJobs,
  registeredJobKinds,
  type RegisteredJobHandler,
} from './handlers';
import {
  CLAIM_BATCH,
  MAX_ATTEMPTS,
  MAX_CONCURRENT_JOBS,
  ROUNDS_PER_TICK,
  claimDueJobs,
  failedJobCount,
  recordJobFailure,
  recordJobSuccess,
  syncPeriodicJobs,
  unregisteredKindBacklog,
  type JobRow,
} from './queue';

const TICK_MS = 5000;
// Longer than a worst-case batch of handlers and shorter than LEASE_SECONDS, so a
// tick that overruns only overlaps with rows the next claim is still barred from
// taking.
export const TICK_BUDGET_MS = 45_000;
const MAINTENANCE_EVERY_TICKS = 60;

// Process-wide rather than per tick: the budget in startWorker stops waiting for a
// tick but not the handlers it already started, so a per-tick count would let every
// later tick pile another batch on top of them.
let inFlight = 0;

// For tests: zeroes the counter without waiting for in-flight handlers. Not a
// repair — runDueJobs' own finally balances it — but a tick that outlives the test
// that started it keeps holding its slots, and the next caller would then be
// answered 0 with no way to tell that from an empty queue.
export function resetInFlightJobs(): void {
  inFlight = 0;
}

export async function runDueJobs(): Promise<number> {
  const kinds = registeredJobKinds();
  if (kinds.length === 0) return 0;

  // Reserved before the claim: two overlapping ticks would otherwise both read the
  // same free slots and both fill them.
  let held = MAX_CONCURRENT_JOBS - inFlight;
  if (held <= 0) return 0;
  inFlight += held;

  try {
    const claimed = await claimDueJobs(kinds, Math.min(CLAIM_BATCH, held * ROUNDS_PER_TICK));
    const runnerCount = Math.min(held, claimed.length);
    inFlight -= held - runnerCount;
    held = runnerCount;

    let cursor = 0;
    const runners = Array.from({ length: runnerCount }, async () => {
      for (;;) {
        const job = claimed[cursor++];
        if (job === undefined) return;
        await runJob(job);
      }
    });
    await Promise.all(runners);
    return claimed.length;
  } finally {
    inFlight -= held;
  }
}

// Bounds how long the runner waits, not the handler: an overrunning handler
// keeps going and its row is re-claimed once the lease lapses, which the handler
// contract already requires it to survive.
async function withTimeout(
  handler: RegisteredJobHandler,
  payload: JobRow['payload']
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      handler.run(payload),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Handler exceeded ${String(handler.timeoutMs)}ms`)),
          handler.timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runJob(job: JobRow): Promise<void> {
  try {
    const handler = jobHandler(job.kind);
    if (handler === undefined) {
      throw new Error(`No handler registered for kind ${job.kind}`);
    }
    await withTimeout(handler, job.payload);
    await recordJobSuccess(job);
    return;
  } catch (err) {
    const error = errorText(err);
    const terminal = job.interval_seconds === null && job.attempts >= MAX_ATTEMPTS;
    const fields = {
      msg: terminal ? 'Job failed permanently' : 'Job attempt failed',
      job_id: job.id,
      kind: job.kind,
      attempts: job.attempts,
      error,
    };
    if (terminal || job.interval_seconds !== null) {
      logger.error(fields);
    } else {
      logger.warn(fields);
    }
    try {
      await recordJobFailure(job, error);
    } catch (recordErr) {
      logger.error({
        msg: 'Job failure could not be recorded',
        job_id: job.id,
        error: errorText(recordErr),
      });
    }
  }
}

// Failed and orphaned rows are never pruned, so this is the only place either
// becomes visible without someone thinking to go looking.
export async function reportJobBacklog(): Promise<void> {
  for (const entry of await unregisteredKindBacklog(registeredJobKinds())) {
    logger.warn({
      msg: 'Pending jobs have no handler in this process',
      kind: entry.kind,
      count: entry.count,
    });
  }
  const failed = await failedJobCount();
  if (failed > 0) {
    logger.warn({ msg: 'Jobs are parked in failed state', count: failed });
  }
}

export async function runJobMaintenance(): Promise<void> {
  await syncPeriodicJobs(periodicJobs(), registeredJobKinds());
  await reportJobBacklog();
}

export function startJobWorker(): { close: () => void } {
  let ticks = 0;

  return startWorker({
    name: 'Job',
    tickMs: TICK_MS,
    budgetMs: TICK_BUDGET_MS,
    tick: async () => {
      // Repeated rather than done once at start: a handler registered later
      // still gets its schedule, and a row that parks in failed hours later is
      // still reported.
      if (ticks % MAINTENANCE_EVERY_TICKS === 0) await runJobMaintenance();
      ticks += 1;
      await runDueJobs();
    },
  });
}
