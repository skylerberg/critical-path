import crypto from 'crypto';
import { sql } from 'kysely';
import { db } from '../db/index';
import { logger } from '../utils/logger';

export const PERSONAL_ACCESS_TOKEN_PREFIX = 'cpat_';
export const MAX_PERSONAL_ACCESS_TOKENS_PER_USER = 100;
export const LAST_USED_THROTTLE_MS = 60_000;

export function generatePersonalAccessToken(): string {
  return PERSONAL_ACCESS_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

export function isPersonalAccessToken(token: string): boolean {
  return token.startsWith(PERSONAL_ACCESS_TOKEN_PREFIX);
}

// Authentication already reads the column, so asking here costs nothing and
// keeps a busy agent from issuing a write per request. `last_used_at` is
// therefore accurate to the minute, which is all the UI claims.
export function personalAccessTokenUseIsStale(lastUsedAt: Date | null): boolean {
  return lastUsedAt === null || Date.now() - lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS;
}

// Writes on the pool rather than on a request's `c.get('db')`: authentication
// runs inside the transaction opened for a mutation, where this UPDATE would
// hold the token's row lock for the whole request — queuing every other request
// from the same agent behind it — and would be discarded on rollback. The WHERE
// repeats the staleness check so concurrent requests and other replicas collapse
// to one write. A failure here must never turn a valid credential into a 401.
export async function recordPersonalAccessTokenUse(id: string): Promise<void> {
  const cutoff = new Date(Date.now() - LAST_USED_THROTTLE_MS);

  try {
    await db
      .updateTable('personal_access_token')
      .set({ last_used_at: sql`now()` })
      .where('id', '=', id)
      .where((eb) => eb.or([eb('last_used_at', 'is', null), eb('last_used_at', '<', cutoff)]))
      .execute();
  } catch (err) {
    logger.warn({
      msg: 'Failed to record personal access token use',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
