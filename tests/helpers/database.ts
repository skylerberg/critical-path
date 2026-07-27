import { sql } from 'kysely';
import { db } from '../../src/db/index';

export { db };

export async function waitForLockWaiters(count: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await sql<{ waiting: string }>`
      select count(*) as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
    `.execute(db);
    if (Number(rows[0]!.waiting) >= count) return;
    if (Date.now() > deadline) {
      // Returning instead would let the caller's requests race, which passes either way.
      throw new Error(`timed out waiting for ${count} lock waiters`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
