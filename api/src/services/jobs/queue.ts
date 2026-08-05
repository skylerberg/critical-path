import crypto from 'crypto';
import { sql, type Kysely, type Selectable } from 'kysely';
import { db } from '../../db/index';
import type { DB, Job, JsonValue } from '../../db/types';

export const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600];
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
export const PERIODIC_MAX_BACKOFF_SECONDS = 600;
export const LEASE_SECONDS = 60;
export const CLAIM_BATCH = 8;
export const MAX_CONCURRENT_JOBS = 4;
export const MAX_HANDLER_TIMEOUT_MS = 20_000;
// How many handlers deep a claimed row can queue, which is what turns the
// handler timeout into a bound on the whole tick.
export const ROUNDS_PER_TICK = Math.ceil(CLAIM_BATCH / MAX_CONCURRENT_JOBS);

const MAX_ERROR_CHARS = 2000;

export type JobRow = Selectable<Job>;

const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]/;
const CONTACT_KEY = /e-?mail/i;

// Nothing reads this column and nothing reviews what enters it, so an address
// written here would outlive every consent and access check that authorised it.
// Payloads carry ids; handlers re-resolve.
export function assertJobPayload(value: JsonValue, path = 'payload'): void {
  if (typeof value === 'string') {
    if (EMAIL_LIKE.test(value)) {
      throw new Error(`Job payload carries an email address at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJobPayload(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (CONTACT_KEY.test(key)) {
        throw new Error(`Job payload carries a contact field at ${path}.${key}`);
      }
      assertJobPayload(entry ?? null, `${path}.${key}`);
    }
  }
}

export interface EnqueueJobOptions {
  runAt?: Date;
}

// Takes the caller's connection so the enqueue commits or rolls back with the
// mutation that caused it.
export async function enqueueJob(
  connection: Kysely<DB>,
  kind: string,
  payload: JsonValue,
  options: EnqueueJobOptions = {}
): Promise<string> {
  assertJobPayload(payload);
  const id = crypto.randomUUID();
  await connection
    .insertInto('job')
    .values({
      id,
      kind,
      payload: JSON.stringify(payload),
      run_at: options.runAt ?? new Date(),
    })
    .execute();
  return id;
}

// Restricted to the kinds this process handles, so during a rolling deploy an
// old pod leaves a new kind alone instead of claiming it, finding no handler,
// and burning its attempts.
export async function claimDueJobs(kinds: string[], limit: number): Promise<JobRow[]> {
  if (kinds.length === 0) return [];
  const result = await sql<JobRow>`
    update job j
    set attempts = j.attempts + 1,
        run_at = now() + make_interval(secs => ${sql.lit(LEASE_SECONDS)})
    from (
      select j2.id
      from job j2
      where j2.status = 'pending'
        and j2.run_at <= now()
        and j2.kind = any(${kinds}::text[])
      order by j2.run_at
      limit ${limit}
      for update skip locked
    ) claimed
    where j.id = claimed.id
    returning j.*
  `.execute(db);
  return result.rows;
}

export async function recordJobSuccess(job: JobRow): Promise<void> {
  if (job.interval_seconds === null) {
    await db.deleteFrom('job').where('id', '=', job.id).execute();
    return;
  }
  // From completion rather than from the due time, so a schedule that fell
  // behind catches up at its interval instead of firing back to back.
  await db
    .updateTable('job')
    .set({
      run_at: sql<Date>`now() + make_interval(secs => ${sql.lit(job.interval_seconds)})`,
      attempts: 0,
      last_error: null,
    })
    .where('id', '=', job.id)
    .execute();
}

export async function recordJobFailure(job: JobRow, error: string): Promise<void> {
  const lastError = error.slice(0, MAX_ERROR_CHARS);
  // attempts is already post-increment when the claim bumped it; a caller
  // outside the runner may hand over a row it never claimed.
  const step = Math.min(Math.max(job.attempts - 1, 0), BACKOFF_SECONDS.length - 1);
  const backoff = BACKOFF_SECONDS[step];

  // A periodic row is the schedule, so retiring one silently stops every
  // occurrence it drives; it backs off without limit instead.
  if (job.interval_seconds !== null) {
    const capped = Math.min(backoff, PERIODIC_MAX_BACKOFF_SECONDS);
    await db
      .updateTable('job')
      .set({
        run_at: sql<Date>`now() + make_interval(secs => ${sql.lit(capped)})`,
        last_error: lastError,
      })
      .where('id', '=', job.id)
      .execute();
    return;
  }

  if (job.attempts >= MAX_ATTEMPTS) {
    await db
      .updateTable('job')
      .set({ status: 'failed', last_error: lastError })
      .where('id', '=', job.id)
      .execute();
    return;
  }

  await db
    .updateTable('job')
    .set({
      run_at: sql<Date>`now() + make_interval(secs => ${sql.lit(backoff)})`,
      last_error: lastError,
    })
    .where('id', '=', job.id)
    .execute();
}

export interface PeriodicJob {
  kind: string;
  intervalSeconds: number;
}

// Re-run so a deleted schedule comes back, a changed one takes effect and a
// dropped one goes away. run_at is left where it is: reseeding must not drag a
// job that is backed off, or mid-lease on another replica, back to due.
export async function syncPeriodicJobs(
  periodic: PeriodicJob[],
  registeredKinds: string[]
): Promise<void> {
  for (const job of periodic) {
    await db
      .insertInto('job')
      .values({
        id: crypto.randomUUID(),
        kind: job.kind,
        payload: JSON.stringify({}),
        interval_seconds: job.intervalSeconds,
      })
      .onConflict((oc) =>
        oc
          .column('kind')
          .where('interval_seconds', 'is not', null)
          .doUpdateSet({ interval_seconds: job.intervalSeconds })
      )
      .execute();
  }

  // Only kinds this process still handles: a schedule for a kind it knows
  // nothing about belongs to another release and outlives this one.
  const scheduled = new Set(periodic.map((job) => job.kind));
  const retired = registeredKinds.filter((kind) => !scheduled.has(kind));
  if (retired.length === 0) return;
  await db
    .deleteFrom('job')
    .where('interval_seconds', 'is not', null)
    .where('kind', 'in', retired)
    .execute();
}

export async function unregisteredKindBacklog(
  kinds: string[]
): Promise<{ kind: string; count: number }[]> {
  const rows = await db
    .selectFrom('job')
    .select(['kind', (eb) => eb.fn.countAll<string>().as('count')])
    .where('status', '=', 'pending')
    .$if(kinds.length > 0, (qb) => qb.where('kind', 'not in', kinds))
    .groupBy('kind')
    .execute();
  return rows.map((row) => ({ kind: row.kind, count: Number(row.count) }));
}

export async function failedJobCount(): Promise<number> {
  const row = await db
    .selectFrom('job')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('status', '=', 'failed')
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}
