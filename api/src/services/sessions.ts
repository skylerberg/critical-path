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

// True once a session is inside the second half of its life, which is when it gets
// carried forward. Expiry is idle-based rather than absolute: a session opened
// every day would otherwise be signed out on the TTL regardless, costing a login
// and buying nothing, because the token it ended was never idle. Renewing only in
// the second half is what keeps that from costing a write per request — a client
// in constant use renews about twice a TTL and cannot lapse mid-use.
export function sessionRenewalIsDue(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() < sessionTtlMs() / 2;
}

// Writes on the pool rather than on a request's `c.get('db')`, for the reasons
// recorded on `recordPersonalAccessTokenUse`: authentication runs inside the
// transaction a mutation opened, where this UPDATE would hold the session's row
// lock for the rest of the request and be thrown away if it rolled back.
//
// The WHERE repeats the due check so requests arriving together collapse to one
// write, and the boolean says whether this call is the one that moved the expiry:
// the cookie is refreshed on that, and must not claim a renewal that did not
// happen. A failure here must never turn a live credential into a 401 — the next
// request is due too and renews instead.
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

// The header verbatim, so a bad parse costs presentation rather than the record,
// and truncated because it is caller-supplied and otherwise unbounded.
function requestUserAgent(c: SessionRequestContext): string | null {
  const header = c.req.header('user-agent')?.trim();
  return header === undefined || header === '' ? null : header.slice(0, MAX_USER_AGENT_LENGTH);
}

// Takes the request rather than a connection, so no call site can forget the user
// agent: a miss would store NULL, which is indistinguishable from a client that
// sent no header.
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
