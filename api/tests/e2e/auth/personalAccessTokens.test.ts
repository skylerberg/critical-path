import crypto from 'crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { TestContext, type TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { createResetToken } from '../../../src/services/resetToken';
import { subscribeBus, SESSIONS_REVOKED, type BusEntry } from '../../../src/services/realtime/bus';
import {
  MAX_PERSONAL_ACCESS_TOKENS_PER_USER,
  PERSONAL_ACCESS_TOKEN_PREFIX,
} from '../../../src/services/personalAccessTokens';

interface TokenMetadata {
  id: string;
  name: string;
  created_at: string;
  expires_at: string | null;
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function collectBusEntries(run: () => Promise<void>): Promise<BusEntry[]> {
  const seen: BusEntry[] = [];
  const unsubscribe = subscribeBus((entry) => seen.push(entry));
  try {
    await run();
  } finally {
    unsubscribe();
  }
  return seen;
}

describe('Personal access tokens', () => {
  const ctx = new TestContext();

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function createToken(
    user: TestUser,
    body: Record<string, unknown> = {}
  ): Promise<{ token: string; personal_access_token: TokenMetadata }> {
    const res = await ctx
      .request(user.token)
      .post('/api/auth/tokens', { id: newId(), name: 'CI', ...body });
    expect(res.status).toBe(201);
    return (await res.json()) as { token: string; personal_access_token: TokenMetadata };
  }

  async function listTokens(token: string): Promise<TokenMetadata[]> {
    const res = await ctx.request(token).get('/api/auth/tokens');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { personal_access_tokens: TokenMetadata[] };
    return body.personal_access_tokens;
  }

  describe('POST /api/auth/tokens', () => {
    it('returns the secret once and stores only its hash', async () => {
      const user = await ctx.createUser('pat-create');
      const id = newId();

      const res = await ctx.request(user.token).post('/api/auth/tokens', { id, name: 'CI runner' });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { token: string; personal_access_token: TokenMetadata };
      expect(body.token.startsWith(PERSONAL_ACCESS_TOKEN_PREFIX)).toBe(true);
      expect(body.personal_access_token).toEqual({
        id,
        name: 'CI runner',
        created_at: expect.any(String),
        expires_at: null,
      });

      const row = await db
        .selectFrom('personal_access_token')
        .select(['personal_access_token.token_hash', 'personal_access_token.user_id'])
        .where('personal_access_token.id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row.token_hash).toBe(sha256Hex(body.token));
      expect(row.token_hash).not.toBe(body.token);
      expect(row.user_id).toBe(user.id);
    });

    it('mints a token that authenticates as the same user as the session token', async () => {
      const user = await ctx.createUser('pat-auth');
      const { token } = await createToken(user);

      const withToken = await ctx.request(token).get('/api/auth/me');
      expect(withToken.status).toBe(200);
      expect(await withToken.json()).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: null,
        email_verified: false,
      });
    });

    it('accepts a future expiry and keeps a null expiry working', async () => {
      const user = await ctx.createUser('pat-expiry');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const dated = await createToken(user, { name: 'dated', expires_at: expiresAt });
      expect(dated.personal_access_token.expires_at).toBe(new Date(expiresAt).toISOString());
      expect((await ctx.request(dated.token).get('/api/auth/me')).status).toBe(200);

      const never = await createToken(user, { name: 'never', expires_at: null });
      expect(never.personal_access_token.expires_at).toBeNull();
      expect((await ctx.request(never.token).get('/api/auth/me')).status).toBe(200);
    });

    it('rejects a duplicate id with 409', async () => {
      const user = await ctx.createUser('pat-dupe');
      const id = newId();

      expect(
        (await ctx.request(user.token).post('/api/auth/tokens', { id, name: 'a' })).status
      ).toBe(201);
      const second = await ctx.request(user.token).post('/api/auth/tokens', { id, name: 'b' });
      expect(second.status).toBe(409);
    });

    it('rejects a past expiry, an absurd expiry, and a non-ISO expiry', async () => {
      const user = await ctx.createUser('pat-bad-expiry');

      const past = await ctx.request(user.token).post('/api/auth/tokens', {
        id: newId(),
        name: 'past',
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      expect(past.status).toBe(422);
      expect(((await past.json()) as { error: string }).error).toContain('future');

      const absurd = await ctx.request(user.token).post('/api/auth/tokens', {
        id: newId(),
        name: 'absurd',
        expires_at: '+275760-09-13T00:00:00.000Z',
      });
      expect(absurd.status).toBe(422);

      const garbage = await ctx
        .request(user.token)
        .post('/api/auth/tokens', { id: newId(), name: 'garbage', expires_at: 'not-a-date' });
      expect(garbage.status).toBe(422);
      const body = (await garbage.json()) as { error: string; details: unknown[] };
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('rejects an empty or over-long name', async () => {
      const user = await ctx.createUser('pat-bad-name');

      const blank = await ctx
        .request(user.token)
        .post('/api/auth/tokens', { id: newId(), name: '   ' });
      expect(blank.status).toBe(422);

      const long = await ctx
        .request(user.token)
        .post('/api/auth/tokens', { id: newId(), name: 'x'.repeat(101) });
      expect(long.status).toBe(422);
    });

    it('caps a user at the per-user limit until one is revoked', async () => {
      const user = await ctx.createUser('pat-cap');
      await db
        .insertInto('personal_access_token')
        .values(
          Array.from({ length: MAX_PERSONAL_ACCESS_TOKENS_PER_USER }, (_unused, index) => ({
            id: newId(),
            user_id: user.id,
            name: `bulk ${String(index)}`,
            token_hash: sha256Hex(`bulk-${user.id}-${String(index)}`),
            expires_at: null,
          }))
        )
        .execute();

      const capped = await ctx
        .request(user.token)
        .post('/api/auth/tokens', { id: newId(), name: 'one too many' });
      expect(capped.status).toBe(422);
      expect(((await capped.json()) as { error: string }).error).toContain(
        String(MAX_PERSONAL_ACCESS_TOKENS_PER_USER)
      );

      const existing = await listTokens(user.token);
      const revoked = await ctx.request(user.token).delete(`/api/auth/tokens/${existing[0].id}`);
      expect(revoked.status).toBe(204);

      expect(
        (await ctx.request(user.token).post('/api/auth/tokens', { id: newId(), name: 'room now' }))
          .status
      ).toBe(201);
    });

    it('lets a personal access token mint another one', async () => {
      const user = await ctx.createUser('pat-mints-pat');
      const { token } = await createToken(user, { name: 'first' });

      const res = await ctx
        .request(token)
        .post('/api/auth/tokens', { id: newId(), name: 'second' });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { token: string };
      expect((await ctx.request(body.token).get('/api/auth/me')).status).toBe(200);
    });
  });

  describe('GET /api/auth/tokens', () => {
    it('lists the caller tokens without ever exposing a secret', async () => {
      const user = await ctx.createUser('pat-list');
      const created = await createToken(user, { name: 'listed' });

      const res = await ctx.request(user.token).get('/api/auth/tokens');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(created.token);
      const body = JSON.parse(text) as { personal_access_tokens: TokenMetadata[] };
      expect(body.personal_access_tokens).toContainEqual(created.personal_access_token);
      expect(Object.keys(body.personal_access_tokens[0]).sort()).toEqual([
        'created_at',
        'expires_at',
        'id',
        'name',
      ]);
    });

    it('lists newest first', async () => {
      const user = await ctx.createUser('pat-order');
      const now = Date.now();
      const rows = [
        { name: 'middle', created_at: new Date(now - 60_000) },
        { name: 'oldest', created_at: new Date(now - 120_000) },
        { name: 'newest', created_at: new Date(now) },
      ];
      await db
        .insertInto('personal_access_token')
        .values(
          rows.map((row) => ({
            id: newId(),
            user_id: user.id,
            name: row.name,
            token_hash: sha256Hex(`order-${user.id}-${row.name}`),
            expires_at: null,
            created_at: row.created_at,
          }))
        )
        .execute();

      const listed = await listTokens(user.token);
      expect(listed.map((token) => token.name)).toEqual(['newest', 'middle', 'oldest']);
    });

    it('never shows another user tokens', async () => {
      const owner = await ctx.createUser('pat-owner');
      const other = await ctx.createUser('pat-other');
      const created = await createToken(owner, { name: 'private' });

      expect(await listTokens(other.token)).not.toContainEqual(created.personal_access_token);
    });
  });

  describe('expired tokens', () => {
    it('rejects an expired token but keeps the row listed', async () => {
      const user = await ctx.createUser('pat-expired');
      const id = newId();
      const secret = `${PERSONAL_ACCESS_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
      await db
        .insertInto('personal_access_token')
        .values({
          id,
          user_id: user.id,
          name: 'expired',
          token_hash: sha256Hex(secret),
          expires_at: new Date(Date.now() - 60_000),
        })
        .execute();

      expect((await ctx.request(secret).get('/api/auth/me')).status).toBe(401);

      const listed = await listTokens(user.token);
      expect(listed.map((token) => token.id)).toContain(id);
    });
  });

  describe('DELETE /api/auth/tokens/:id', () => {
    it('revokes only that token and publishes sessions_revoked for it', async () => {
      const user = await ctx.createUser('pat-revoke');
      const revoking = await createToken(user, { name: 'doomed' });
      const survivor = await createToken(user, { name: 'survivor' });

      const entries = await collectBusEntries(async () => {
        const res = await ctx
          .request(user.token)
          .delete(`/api/auth/tokens/${revoking.personal_access_token.id}`);
        expect(res.status).toBe(204);
      });

      expect(entries).toContainEqual(
        expect.objectContaining({
          type: SESSIONS_REVOKED,
          data: {
            user_id: user.id,
            personal_access_token_id: revoking.personal_access_token.id,
          },
        })
      );

      expect((await ctx.request(revoking.token).get('/api/auth/me')).status).toBe(401);
      expect((await ctx.request(survivor.token).get('/api/auth/me')).status).toBe(200);
      expect((await ctx.request(user.token).get('/api/auth/me')).status).toBe(200);
      expect((await listTokens(user.token)).map((token) => token.id)).not.toContain(
        revoking.personal_access_token.id
      );
    });

    it('answers 404 for another user token and an unknown id, 400 for a non-uuid', async () => {
      const owner = await ctx.createUser('pat-del-owner');
      const other = await ctx.createUser('pat-del-other');
      const created = await createToken(owner, { name: 'not yours' });

      const foreign = await ctx
        .request(other.token)
        .delete(`/api/auth/tokens/${created.personal_access_token.id}`);
      expect(foreign.status).toBe(404);

      expect((await ctx.request(owner.token).delete(`/api/auth/tokens/${newId()}`)).status).toBe(
        404
      );
      expect((await ctx.request(owner.token).delete('/api/auth/tokens/nope')).status).toBe(400);

      expect((await ctx.request(created.token).get('/api/auth/me')).status).toBe(200);
    });
  });

  describe('interaction with session flows', () => {
    it('survives a password change', async () => {
      const user = await ctx.createUser('pat-change-password');
      const { token } = await createToken(user, { name: 'agent' });

      const res = await ctx.request(user.token).post('/api/auth/change-password', {
        current_password: user.password,
        new_password: 'a-brand-new-password',
      });
      expect(res.status).toBe(200);

      expect((await ctx.request(token).get('/api/auth/me')).status).toBe(200);
      expect(
        await db
          .selectFrom('personal_access_token')
          .select('personal_access_token.id')
          .where('personal_access_token.user_id', '=', user.id)
          .execute()
      ).toHaveLength(1);
    });

    it('survives a password reset', async () => {
      const user = await ctx.createUser('pat-reset-password');
      const { token } = await createToken(user, { name: 'agent' });
      const { alternative_id } = await db
        .selectFrom('app_user')
        .select('app_user.alternative_id')
        .where('app_user.id', '=', user.id)
        .executeTakeFirstOrThrow();

      const res = await ctx.request().post('/api/auth/reset-password', {
        token: createResetToken(alternative_id),
        new_password: 'another-brand-new-password',
      });
      expect(res.status).toBe(204);

      expect((await ctx.request(token).get('/api/auth/me')).status).toBe(200);
    });

    it('is untouched by a logout made with it', async () => {
      const user = await ctx.createUser('pat-logout');
      const { token } = await createToken(user, { name: 'agent' });

      const res = await ctx.request(token).post('/api/auth/logout');
      expect(res.status).toBe(204);

      expect((await ctx.request(token).get('/api/auth/me')).status).toBe(200);
      expect((await ctx.request(user.token).get('/api/auth/me')).status).toBe(200);
    });

    it('is cascaded away with the user row', async () => {
      const user = await ctx.createUser('pat-cascade');
      await createToken(user, { name: 'doomed with the account' });

      await db.deleteFrom('app_user').where('app_user.id', '=', user.id).execute();

      const rows = await db
        .selectFrom('personal_access_token')
        .select('personal_access_token.id')
        .where('personal_access_token.user_id', '=', user.id)
        .execute();
      expect(rows).toHaveLength(0);
    });
  });

  it('requires authentication on every endpoint', async () => {
    expect(
      (await ctx.request().post('/api/auth/tokens', { id: newId(), name: 'anon' })).status
    ).toBe(401);
    expect((await ctx.request().get('/api/auth/tokens')).status).toBe(401);
    expect((await ctx.request().delete(`/api/auth/tokens/${newId()}`)).status).toBe(401);
  });
});
