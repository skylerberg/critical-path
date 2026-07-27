import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { isPersonalAccessToken } from './personalAccessTokens';
import { hashBearerToken } from './sessions';

export type CredentialKind = 'session' | 'personal_access_token';

export interface AuthenticatedCredential {
  kind: CredentialKind;
  id: string;
  user: {
    id: string;
    email: string;
    name: string;
    avatar_storage_key: string | null;
  };
}

async function authenticatePersonalAccessToken(
  db: Kysely<DB>,
  tokenHash: string
): Promise<AuthenticatedCredential | null> {
  const row = await db
    .selectFrom('personal_access_token')
    .innerJoin('app_user', 'app_user.id', 'personal_access_token.user_id')
    .select([
      'personal_access_token.id as credential_id',
      'personal_access_token.expires_at',
      'app_user.id as user_id',
      'app_user.email',
      'app_user.name',
      'app_user.avatar_storage_key',
    ])
    .where('personal_access_token.token_hash', '=', tokenHash)
    .executeTakeFirst();

  if (!row || (row.expires_at !== null && row.expires_at.getTime() <= Date.now())) {
    return null;
  }

  return {
    kind: 'personal_access_token',
    id: row.credential_id,
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      avatar_storage_key: row.avatar_storage_key,
    },
  };
}

async function authenticateSessionToken(
  db: Kysely<DB>,
  tokenHash: string
): Promise<AuthenticatedCredential | null> {
  const row = await db
    .selectFrom('session')
    .innerJoin('app_user', 'app_user.id', 'session.user_id')
    .select([
      'session.id as credential_id',
      'session.expires_at',
      'app_user.id as user_id',
      'app_user.email',
      'app_user.name',
      'app_user.avatar_storage_key',
    ])
    .where('session.token_hash', '=', tokenHash)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  if (row.expires_at.getTime() <= Date.now()) {
    // Best-effort: rolled back if a surrounding transaction aborts on the 401.
    await db.deleteFrom('session').where('session.id', '=', row.credential_id).execute();
    return null;
  }

  return {
    kind: 'session',
    id: row.credential_id,
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      avatar_storage_key: row.avatar_storage_key,
    },
  };
}

export async function authenticateBearerToken(
  db: Kysely<DB>,
  token: string
): Promise<AuthenticatedCredential | null> {
  const tokenHash = hashBearerToken(token);

  if (isPersonalAccessToken(token)) {
    const credential = await authenticatePersonalAccessToken(db, tokenHash);
    if (credential) {
      return credential;
    }
    // The prefix is a routing hint, not a guarantee: a base64url session token
    // can start with it, so a miss still has to try the session table.
  }

  return await authenticateSessionToken(db, tokenHash);
}

export async function credentialIsLive(
  db: Kysely<DB>,
  kind: CredentialKind,
  id: string
): Promise<boolean> {
  if (kind === 'personal_access_token') {
    const row = await db
      .selectFrom('personal_access_token')
      .select('personal_access_token.id')
      .where('personal_access_token.id', '=', id)
      .where((eb) =>
        eb.or([
          eb('personal_access_token.expires_at', 'is', null),
          eb('personal_access_token.expires_at', '>', new Date()),
        ])
      )
      .executeTakeFirst();
    return row !== undefined;
  }

  const row = await db
    .selectFrom('session')
    .select('session.id')
    .where('session.id', '=', id)
    .where('session.expires_at', '>', new Date())
    .executeTakeFirst();
  return row !== undefined;
}
