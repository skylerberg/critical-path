import crypto from 'crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { env } from '../config/env';

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(db: Kysely<DB>, userId: string): Promise<string> {
  const token = generateSessionToken();
  await db
    .insertInto('session')
    .values({
      id: crypto.randomUUID(),
      user_id: userId,
      token_hash: hashSessionToken(token),
      expires_at: new Date(Date.now() + env.sessionTtlDays * 24 * 60 * 60 * 1000),
    })
    .execute();
  return token;
}

export async function deleteSessionByTokenHash(db: Kysely<DB>, tokenHash: string): Promise<void> {
  await db.deleteFrom('session').where('token_hash', '=', tokenHash).execute();
}
