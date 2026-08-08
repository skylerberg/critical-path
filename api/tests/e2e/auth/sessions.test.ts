import crypto from 'crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { TestContext, type TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { subscribeBus, SESSIONS_REVOKED, type BusEntry } from '../../../src/services/realtime/bus';

interface SessionMetadata {
  id: string;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  is_current: boolean;
}

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

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

describe('Sessions', () => {
  const ctx = new TestContext();

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function listSessions(token: string): Promise<SessionMetadata[]> {
    const res = await ctx.request(token).get('/api/auth/sessions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: SessionMetadata[] };
    return body.sessions;
  }

  async function logIn(user: TestUser, userAgent?: string): Promise<string> {
    const res = await ctx
      .request(undefined, userAgent)
      .post('/api/auth/login', { email: user.email, password: user.password });
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  }

  async function userAgentOf(token: string): Promise<string | null> {
    const row = await db
      .selectFrom('session')
      .select('session.user_agent')
      .where('session.token_hash', '=', sha256Hex(token))
      .executeTakeFirstOrThrow();
    return row.user_agent;
  }

  async function sessionIdFor(token: string): Promise<string> {
    const row = await db
      .selectFrom('session')
      .select('session.id')
      .where('session.token_hash', '=', sha256Hex(token))
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function insertSession(
    userId: string,
    overrides: { created_at?: Date; expires_at?: Date } = {}
  ): Promise<string> {
    const id = newId();
    await db
      .insertInto('session')
      .values({
        id,
        user_id: userId,
        token_hash: sha256Hex(`fixture-${id}`),
        expires_at: overrides.expires_at ?? new Date(Date.now() + 60 * 60 * 1000),
        ...(overrides.created_at === undefined ? {} : { created_at: overrides.created_at }),
      })
      .execute();
    return id;
  }

  describe('GET /api/auth/sessions', () => {
    it('lists the caller sessions and marks the one making the request', async () => {
      const user = await ctx.createUser('sess-list');
      const otherToken = await logIn(user);

      const sessions = await listSessions(user.token);

      expect(sessions.map((entry) => entry.id).sort()).toEqual(
        [await sessionIdFor(user.token), await sessionIdFor(otherToken)].sort()
      );
      const current = sessions.filter((entry) => entry.is_current);
      expect(current).toHaveLength(1);
      expect(current[0].id).toBe(await sessionIdFor(user.token));
      expect(Object.keys(sessions[0]).sort()).toEqual([
        'created_at',
        'expires_at',
        'id',
        'is_current',
        'user_agent',
      ]);
    });

    it('never exposes the token or its hash', async () => {
      const user = await ctx.createUser('sess-no-secret');

      const res = await ctx.request(user.token).get('/api/auth/sessions');
      const text = await res.text();

      expect(text).not.toContain(user.token);
      expect(text).not.toContain(sha256Hex(user.token));
    });

    it('lists newest first', async () => {
      const user = await ctx.createUser('sess-order');
      const now = Date.now();
      const middle = await insertSession(user.id, { created_at: new Date(now - 60_000) });
      const oldest = await insertSession(user.id, { created_at: new Date(now - 120_000) });
      const newest = await insertSession(user.id, { created_at: new Date(now + 60_000) });

      const listed = (await listSessions(user.token)).map((entry) => entry.id);

      expect(listed.filter((id) => [newest, middle, oldest].includes(id))).toEqual([
        newest,
        middle,
        oldest,
      ]);
    });

    it('leaves out a session that has already expired', async () => {
      const user = await ctx.createUser('sess-expired');
      const expired = await insertSession(user.id, { expires_at: new Date(Date.now() - 60_000) });
      const live = await insertSession(user.id);

      const listed = (await listSessions(user.token)).map((entry) => entry.id);

      expect(listed).toContain(live);
      expect(listed).not.toContain(expired);
    });

    it('marks nothing current for a caller holding a personal access token', async () => {
      const user = await ctx.createUser('sess-pat-caller');
      const created = await ctx
        .request(user.token)
        .post('/api/auth/tokens', { id: newId(), name: 'agent' });
      expect(created.status).toBe(201);
      const { token } = (await created.json()) as { token: string };

      const sessions = await listSessions(token);

      expect(sessions.map((entry) => entry.id)).toContain(await sessionIdFor(user.token));
      expect(sessions.some((entry) => entry.is_current)).toBe(false);
    });

    it('reports the user agent the session was created with, verbatim', async () => {
      const user = await ctx.createUser('sess-ua');
      const token = await logIn(user, CHROME_UA);

      const listed = await listSessions(token);

      expect(listed.find((entry) => entry.is_current)?.user_agent).toBe(CHROME_UA);
    });

    it('reports null for a session created without a user agent', async () => {
      const user = await ctx.createUser('sess-ua-absent');
      const token = await logIn(user);

      const listed = await listSessions(token);

      expect(listed.find((entry) => entry.is_current)?.user_agent).toBeNull();
    });

    it('never shows another user sessions', async () => {
      const owner = await ctx.createUser('sess-owner');
      const other = await ctx.createUser('sess-other');

      const listed = (await listSessions(other.token)).map((entry) => entry.id);

      expect(listed).not.toContain(await sessionIdFor(owner.token));
    });
  });

  describe('DELETE /api/auth/sessions/:id', () => {
    it('revokes only that session and publishes sessions_revoked naming it', async () => {
      const user = await ctx.createUser('sess-revoke');
      const doomedToken = await logIn(user);
      const doomedId = await sessionIdFor(doomedToken);

      const entries = await collectBusEntries(async () => {
        const res = await ctx.request(user.token).delete(`/api/auth/sessions/${doomedId}`);
        expect(res.status).toBe(204);
      });

      expect(entries).toEqual([
        {
          type: SESSIONS_REVOKED,
          project_id: null,
          data: { user_id: user.id, session_id: doomedId },
        },
      ]);
      expect((await ctx.request(doomedToken).get('/api/auth/me')).status).toBe(401);
      expect((await ctx.request(user.token).get('/api/auth/me')).status).toBe(200);
      expect((await listSessions(user.token)).map((entry) => entry.id)).not.toContain(doomedId);
    });

    it('signs the caller out when it revokes the session making the request', async () => {
      const user = await ctx.createUser('sess-revoke-self');
      const survivorToken = await logIn(user);
      const current = (await listSessions(user.token)).find((entry) => entry.is_current);

      const res = await ctx.request(user.token).delete(`/api/auth/sessions/${current?.id ?? ''}`);
      expect(res.status).toBe(204);

      expect((await ctx.request(user.token).get('/api/auth/me')).status).toBe(401);
      expect((await ctx.request(survivorToken).get('/api/auth/me')).status).toBe(200);
    });

    it('leaves personal access tokens untouched', async () => {
      const user = await ctx.createUser('sess-revoke-keeps-pat');
      const created = await ctx
        .request(user.token)
        .post('/api/auth/tokens', { id: newId(), name: 'agent' });
      const { token } = (await created.json()) as { token: string };
      const doomedId = await sessionIdFor(await logIn(user));

      expect((await ctx.request(user.token).delete(`/api/auth/sessions/${doomedId}`)).status).toBe(
        204
      );

      expect((await ctx.request(token).get('/api/auth/me')).status).toBe(200);
    });

    it('answers 404 for another user session and an unknown id, 400 for a non-uuid', async () => {
      const owner = await ctx.createUser('sess-del-owner');
      const other = await ctx.createUser('sess-del-other');
      const ownerSessionId = await sessionIdFor(owner.token);

      expect(
        (await ctx.request(other.token).delete(`/api/auth/sessions/${ownerSessionId}`)).status
      ).toBe(404);
      expect((await ctx.request(owner.token).delete(`/api/auth/sessions/${newId()}`)).status).toBe(
        404
      );
      expect((await ctx.request(owner.token).delete('/api/auth/sessions/nope')).status).toBe(400);

      expect((await ctx.request(owner.token).get('/api/auth/me')).status).toBe(200);
    });
  });

  describe('recording the user agent', () => {
    it('records it on signup, not only on login', async () => {
      const user = await ctx.createUser('sess-ua-writers', CHROME_UA);
      const loginToken = await logIn(user, CHROME_UA);

      expect({
        signup: await userAgentOf(user.token),
        login: await userAgentOf(loginToken),
      }).toEqual({ signup: CHROME_UA, login: CHROME_UA });
    });

    it('caps an oversized header instead of storing it whole', async () => {
      const user = await ctx.createUser('sess-ua-long');
      const oversized = 'x'.repeat(4000);

      const token = await logIn(user, oversized);

      const recorded = await userAgentOf(token);
      expect(recorded).toBe('x'.repeat(512));
    });
  });

  it('requires authentication on every endpoint', async () => {
    expect((await ctx.request().get('/api/auth/sessions')).status).toBe(401);
    expect((await ctx.request().delete(`/api/auth/sessions/${newId()}`)).status).toBe(401);
  });
});
