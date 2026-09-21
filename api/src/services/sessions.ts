import crypto from 'crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { db } from '../db/index';
import { env } from '../config/env';
import type { PublicContext } from '../types/index';
import { logger } from '../utils/logger';
import { errorText } from '../utils/errors';

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashBearerToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function sessionTtlMs(): number {
  return env.sessionTtlDays * 24 * 60 * 60 * 1000;
}

function sessionExpiry(): Date {
  return new Date(Date.now() + sessionTtlMs());
}

// Expiry is idle-based rather than absolute. A session opened every day would
// otherwise be signed out on the TTL regardless, which costs a login and buys
// nothing: the token it ended was never idle, and the only sessions worth
// closing on a clock are the ones nobody is using. The halfway mark is what
// keeps that from costing a write per request — a client in constant use renews
// about twice a TTL, and one returning at any point in the second half of a
// session's life is carried forward before it can lapse.
export function sessionRenewalIsDue(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() < sessionTtlMs() / 2;
}

// Writes on the pool rather than on a request's `c.get('db')`, for the reasons
// recorded on `recordPersonalAccessTokenUse`: authentication runs inside the
// transaction a mutation opened, where this UPDATE would hold the session's row
// lock for the rest of the request and be thrown away if it rolled back. The
// WHERE repeats the due check so requests arriving together collapse to one
// write, and the answer says whether this call is the one that moved the
// expiry — the cookie is refreshed on that, and must not claim a renewal that
// did not happen. A failure here must never turn a live credential into a 401;
// the next request is due too and renews instead.
export async function renewSession(id: string): Promise<boolean> {
  const dueBefore = new Date(Date.now() + sessionTtlMs() / 2);

  try {
    const result = await db
      .updateTable('session')
      .set({ expires_at: sessionExpiry() })
      .where('id', '=', id)
      .where('expires_at', '<', dueBefore)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  } catch (err) {
    logger.warn({ msg: 'Failed to renew session', error: errorText(err) });
    return false;
  }
}

export interface CreatedSession {
  id: string;
  token: string;
}

export type SessionRequestContext = Pick<PublicContext, 'get' | 'req'>;

const MAX_USER_AGENT_LENGTH = 512;

// Stored verbatim so a bad parse costs presentation, never the record; capped
// because the header is caller-supplied and otherwise unbounded.
function requestUserAgent(c: SessionRequestContext): string | null {
  const header = c.req.header('user-agent')?.trim();
  return header === undefined || header === '' ? null : header.slice(0, MAX_USER_AGENT_LENGTH);
}

// Takes the request, not a connection, so no call site can omit the user agent:
// a miss would store NULL, which is indistinguishable from a client that sent
// no header.
export async function createSession(
  c: SessionRequestContext,
  userId: string
): Promise<CreatedSession> {
  const id = crypto.randomUUID();
  const token = generateSessionToken();
  await c
    .get('db')
    .insertInto('session')
    .values({
      id,
      user_id: userId,
      token_hash: hashBearerToken(token),
      user_agent: requestUserAgent(c),
      expires_at: sessionExpiry(),
    })
    .execute();
  return { id, token };
}

export async function deleteSessionByTokenHash(db: Kysely<DB>, tokenHash: string): Promise<void> {
  await db.deleteFrom('session').where('token_hash', '=', tokenHash).execute();
}
