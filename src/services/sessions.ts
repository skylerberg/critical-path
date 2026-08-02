import crypto from 'crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { env } from '../config/env';
import type { AppContext } from '../types/index';

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashBearerToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface CreatedSession {
  id: string;
  token: string;
}

export type SessionRequestContext = Pick<AppContext, 'get' | 'req'>;

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
      expires_at: new Date(Date.now() + env.sessionTtlDays * 24 * 60 * 60 * 1000),
    })
    .execute();
  return { id, token };
}

export async function deleteSessionByTokenHash(db: Kysely<DB>, tokenHash: string): Promise<void> {
  await db.deleteFrom('session').where('token_hash', '=', tokenHash).execute();
}
