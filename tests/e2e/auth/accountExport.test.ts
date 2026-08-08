import crypto from 'crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { TestContext, type TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId, rankKey } from '../../helpers/fixtures';

interface ExportedSession {
  id: string;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
}

interface ExportedToken {
  id: string;
  name: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

interface ExportedFeedback {
  id: string;
  message: string;
  page_path: string | null;
  created_at: string;
}

interface ExportedProject {
  id: string;
  name: string;
  role: string;
  joined_at: string;
}

interface AccountExportBody {
  format: string;
  version: number;
  exported_at: string;
  account: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
    created_at: string;
    email_verified_at: string | null;
    notification_settings: {
      task_assigned: boolean;
      added_to_project: boolean;
      bulk_task_assigned: boolean;
    };
  };
  sessions: ExportedSession[];
  personal_access_tokens: ExportedToken[];
  feedback: ExportedFeedback[];
  projects: ExportedProject[];
}

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

describe('GET /api/auth/me/export', () => {
  const ctx = new TestContext();
  const strayProjectIds: string[] = [];

  afterAll(async () => {
    if (strayProjectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', strayProjectIds).execute();
    }
    await ctx.cleanup();
  });

  async function exportOf(token: string): Promise<{ response: Response; raw: string }> {
    const response = await ctx.request(token).get('/api/auth/me/export');
    expect(response.status).toBe(200);
    return { response, raw: await response.text() };
  }

  async function exportBody(token: string): Promise<AccountExportBody> {
    return JSON.parse((await exportOf(token)).raw) as AccountExportBody;
  }

  async function createToken(user: TestUser, name: string): Promise<string> {
    const res = await ctx.request(user.token).post('/api/auth/tokens', { id: newId(), name });
    expect(res.status).toBe(201);
    return ((await res.json()) as { token: string }).token;
  }

  async function sendFeedback(user: TestUser, message: string, pagePath?: string): Promise<void> {
    const res = await ctx.request(user.token).post('/api/feedback', {
      id: newId(),
      message,
      ...(pagePath ? { page_path: pagePath } : {}),
    });
    expect(res.status).toBe(201);
  }

  async function createProject(user: TestUser, name: string): Promise<string> {
    const id = newId();
    const res = await ctx.request(user.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    strayProjectIds.push(id);
    return id;
  }

  async function insertSession(
    userId: string,
    overrides: { user_agent?: string; created_at?: Date; expires_at?: Date } = {}
  ): Promise<string> {
    const id = newId();
    await db
      .insertInto('session')
      .values({
        id,
        user_id: userId,
        token_hash: crypto.randomBytes(32).toString('hex'),
        user_agent: overrides.user_agent ?? null,
        ...(overrides.created_at ? { created_at: overrides.created_at } : {}),
        expires_at: overrides.expires_at ?? new Date(Date.now() + 3_600_000),
      })
      .execute();
    return id;
  }

  async function insertToken(
    userId: string,
    name: string,
    createdAt: Date,
    expiresAt: Date | null,
    lastUsedAt: Date | null = null
  ): Promise<void> {
    await db
      .insertInto('personal_access_token')
      .values({
        id: newId(),
        user_id: userId,
        name,
        token_hash: crypto.randomBytes(32).toString('hex'),
        created_at: createdAt,
        expires_at: expiresAt,
        last_used_at: lastUsedAt,
      })
      .execute();
  }

  async function insertFeedback(userId: string, message: string, createdAt: Date): Promise<void> {
    await db
      .insertInto('feedback')
      .values({ id: newId(), user_id: userId, message, created_at: createdAt })
      .execute();
  }

  async function insertInvitation(from: TestUser, projectId: string, email: string): Promise<void> {
    await db
      .insertInto('project_invitation')
      .values({
        id: newId(),
        project_id: projectId,
        email,
        invited_by: from.id,
        token_hash: crypto.randomBytes(32).toString('hex'),
        expires_at: new Date(Date.now() + 7 * 24 * 3_600_000),
      })
      .execute();
  }

  it('hands back a manifest of the account under an attachment filename', async () => {
    const user = await ctx.createUser('export-shape');
    await createToken(user, 'ci runner');
    await sendFeedback(user, 'The board scrolls oddly on my phone.', '/projects/1');
    const projectId = await createProject(user, 'Shape Board');

    const { response, raw } = await exportOf(user.token);
    const body = JSON.parse(raw) as AccountExportBody;

    expect(response.headers.get('content-type')).toContain('application/json');
    const disposition = response.headers.get('content-disposition') ?? '<no header>';
    expect(disposition).toMatch(
      /^attachment; filename="critical-path-account-\d{4}-\d{2}-\d{2}\.json"$/
    );
    // The filename date and the manifest timestamp come from one reading of the
    // clock, so a mismatch means two were taken.
    expect(disposition).toContain(`critical-path-account-${body.exported_at.slice(0, 10)}.json`);

    expect(body.format).toBe('critical-path-account-export');
    expect(body.version).toBe(1);
    expect(Object.keys(body).sort()).toEqual([
      'account',
      'exported_at',
      'feedback',
      'format',
      'personal_access_tokens',
      'projects',
      'sessions',
      'version',
    ]);
    expect(Object.keys(body.account).sort()).toEqual([
      'avatar_url',
      'created_at',
      'email',
      'email_verified_at',
      'id',
      'name',
      'notification_settings',
    ]);
    expect(body.account.id).toBe(user.id);
    expect(body.account.email).toBe(user.email);
    expect(body.sessions).toHaveLength(1);
    expect(body.personal_access_tokens.map((token) => token.name)).toEqual(['ci runner']);
    expect(body.feedback).toEqual([
      {
        id: expect.any(String),
        message: 'The board scrolls oddly on my phone.',
        page_path: '/projects/1',
        created_at: expect.any(String),
      },
    ]);
    expect(body.projects).toEqual([
      { id: projectId, name: 'Shape Board', role: 'owner', joined_at: expect.any(String) },
    ]);
  });

  it('never serialises a stored secret', async () => {
    const user = await ctx.createUser('export-secrets');
    const patToken = await createToken(user, 'secret scan');

    const account = await db
      .selectFrom('app_user')
      .select(['password_hash', 'alternative_id'])
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    const sessionHashes = await db
      .selectFrom('session')
      .select('token_hash')
      .where('user_id', '=', user.id)
      .execute();
    const tokenHashes = await db
      .selectFrom('personal_access_token')
      .select('token_hash')
      .where('user_id', '=', user.id)
      .execute();

    const { raw } = await exportOf(user.token);

    const secrets = [
      account.password_hash,
      account.alternative_id,
      user.token,
      patToken,
      ...sessionHashes.map((row) => row.token_hash),
      ...tokenHashes.map((row) => row.token_hash),
    ];
    expect(secrets).toHaveLength(6);
    for (const secret of secrets) {
      expect(secret).not.toBe('');
      expect(raw).not.toContain(secret);
    }
  });

  // The rows are never pruned, so an export that reused the session listing's
  // expiry filter would report less than is held — the one outcome this whole
  // endpoint exists to prevent.
  it('exports a lapsed session that the session listing hides', async () => {
    const user = await ctx.createUser('export-lapsed');
    const startedAt = new Date('2026-02-03T04:05:06.000Z');
    const lapsedAt = new Date('2026-02-10T04:05:06.000Z');
    const lapsedId = await insertSession(user.id, {
      user_agent: 'LapsedAgent/1.0',
      created_at: startedAt,
      expires_at: lapsedAt,
    });

    const body = await exportBody(user.token);
    const listed = await ctx.request(user.token).get('/api/auth/sessions');
    expect(listed.status).toBe(200);
    const live = ((await listed.json()) as { sessions: { id: string }[] }).sessions;

    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.map((session) => session.id)).toContain(lapsedId);
    expect(body.sessions.find((session) => session.id === lapsedId)).toEqual({
      id: lapsedId,
      user_agent: 'LapsedAgent/1.0',
      created_at: startedAt.toISOString(),
      expires_at: lapsedAt.toISOString(),
    });
    expect(live.map((session) => session.id)).not.toContain(lapsedId);
    expect(live).toHaveLength(1);
  });

  it('lists sessions, tokens and feedback newest first, each expiry as stored', async () => {
    const user = await ctx.createUser('export-order');
    const older = new Date('2026-01-02T03:04:05.000Z');
    const newer = new Date('2026-04-05T06:07:08.000Z');
    const tokenExpiry = new Date('2027-09-10T11:12:13.000Z');

    await insertSession(user.id, { user_agent: 'OlderAgent/1.0', created_at: older });
    await insertSession(user.id, { user_agent: 'NewerAgent/2.0', created_at: newer });
    await insertToken(user.id, 'older key', older, null);
    await insertToken(user.id, 'newer key', newer, tokenExpiry, newer);
    await insertFeedback(user.id, 'older note', older);
    await insertFeedback(user.id, 'newer note', newer);

    const body = await exportBody(user.token);

    // Signup issued a session with no User-Agent, and it is the newest of the three.
    expect(body.sessions.map((session) => session.user_agent)).toEqual([
      null,
      'NewerAgent/2.0',
      'OlderAgent/1.0',
    ]);
    expect(body.personal_access_tokens).toEqual([
      {
        id: expect.any(String),
        name: 'newer key',
        created_at: newer.toISOString(),
        expires_at: tokenExpiry.toISOString(),
        last_used_at: newer.toISOString(),
      },
      {
        id: expect.any(String),
        name: 'older key',
        created_at: older.toISOString(),
        expires_at: null,
        last_used_at: null,
      },
    ]);
    expect(body.feedback.map((entry) => [entry.message, entry.created_at])).toEqual([
      ['newer note', newer.toISOString()],
      ['older note', older.toISOString()],
    ]);
  });

  it('reports the notification preferences the account stored, not the defaults', async () => {
    const user = await ctx.createUser('export-prefs');
    const saved = await ctx.request(user.token).put('/api/auth/me/notification-settings', {
      task_assigned: false,
      added_to_project: true,
      bulk_task_assigned: false,
    });
    expect(saved.status).toBe(200);

    const body = await exportBody(user.token);

    expect(body.account.notification_settings).toEqual({
      task_assigned: false,
      added_to_project: true,
      bulk_task_assigned: false,
    });
  });

  it('carries the avatar in its published form and the recorded verification time', async () => {
    const user = await ctx.createUser('export-profile');
    const storageKey = newId();
    const verifiedAt = new Date('2026-05-06T07:08:09.000Z');
    await db
      .updateTable('app_user')
      .set({
        avatar_storage_key: storageKey,
        avatar_content_type: 'image/webp',
        email_verified_at: verifiedAt,
      })
      .where('id', '=', user.id)
      .execute();
    const stored = await db
      .selectFrom('app_user')
      .select('created_at')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();

    const { raw } = await exportOf(user.token);
    const body = JSON.parse(raw) as AccountExportBody;

    expect(body.account.avatar_url).toBe(`/api/avatars/${storageKey}`);
    expect(raw).not.toContain('avatar_storage_key');
    expect(body.account.email_verified_at).toBe(verifiedAt.toISOString());
    expect(body.account.created_at).toBe(stored.created_at.toISOString());
  });

  // The exported shapes carry no user id, so a builder missing its where clause
  // leaks another account's rows without any of them looking foreign. Only the
  // counts and the other account's own strings can catch it.
  it("carries none of another account's sessions, tokens, feedback or boards", async () => {
    const alpha = await ctx.createUser('export-alpha');
    const bravo = await ctx.createUser('export-bravo');

    await insertSession(bravo.id, { user_agent: 'BravoAgent/9.9' });
    await createToken(bravo, 'bravo deploy key');
    await sendFeedback(bravo, 'Bravo cannot find the archive button.');
    await createProject(bravo, 'Bravo Solo Board');

    await createToken(alpha, 'alpha laptop');
    await sendFeedback(alpha, 'Alpha would like darker dark mode.');
    const alphaProjectId = await createProject(alpha, 'Alpha Board');

    const { raw } = await exportOf(alpha.token);
    const body = JSON.parse(raw) as AccountExportBody;

    expect(body.sessions).toHaveLength(1);
    expect(body.personal_access_tokens.map((token) => token.name)).toEqual(['alpha laptop']);
    expect(body.feedback.map((entry) => entry.message)).toEqual([
      'Alpha would like darker dark mode.',
    ]);
    expect(body.projects).toEqual([
      { id: alphaProjectId, name: 'Alpha Board', role: 'owner', joined_at: expect.any(String) },
    ]);

    for (const foreign of [
      bravo.id,
      bravo.email,
      bravo.name,
      'BravoAgent/9.9',
      'bravo deploy key',
      'Bravo cannot find the archive button.',
      'Bravo Solo Board',
    ]) {
      expect(raw).not.toContain(foreign);
    }
  });

  const key1000 = rankKey(1000);
  it('names no other person even when accounts are entangled', async () => {
    const owner = await ctx.createUser('export-owner');
    const other = await ctx.createUser('export-other');
    const projectId = await createProject(owner, 'Entangled Board');
    const otherProjectId = await createProject(other, 'Other Private Board');

    const columnId = newId();
    const taskId = newId();
    await db
      .insertInto('project_member')
      .values({ project_id: projectId, user_id: other.id, role: 'editor' })
      .execute();
    await db
      .insertInto('board_column')
      .values({ id: columnId, project_id: projectId, name: 'Doing', sort_key: key1000 })
      .execute();
    await db
      .insertInto('task')
      .values({
        id: taskId,
        project_id: projectId,
        column_id: columnId,
        title: 'x',
        sort_key: key1000,
      })
      .execute();
    await db
      .insertInto('task_comment')
      .values({
        id: newId(),
        task_id: taskId,
        user_id: other.id,
        body: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'looked at this' }] }],
        }),
      })
      .execute();
    await insertInvitation(owner, projectId, 'pending-invitee@test.example.com');
    await insertInvitation(other, otherProjectId, owner.email);

    const invitationHashes = await db
      .selectFrom('project_invitation')
      .select('token_hash')
      .execute();
    expect(invitationHashes.length).toBeGreaterThanOrEqual(2);

    const { raw } = await exportOf(owner.token);
    const body = JSON.parse(raw) as AccountExportBody;

    expect(body.projects.map((project) => project.name)).toEqual(['Entangled Board']);
    expect(Object.keys(body.projects[0]!).sort()).toEqual(['id', 'joined_at', 'name', 'role']);
    for (const foreign of [
      other.id,
      other.email,
      other.name,
      'Other Private Board',
      'pending-invitee@test.example.com',
      'looked at this',
      ...invitationHashes.map((row) => row.token_hash),
    ]) {
      expect(raw).not.toContain(foreign);
    }
    expect(raw).toContain(owner.email);
  });

  it('marks a created board owner and a membership by its stored role and date', async () => {
    const owner = await ctx.createUser('export-roles');
    const viewer = await ctx.createUser('export-viewer');
    const ownedId = await createProject(owner, 'Owned Board');
    const archivedId = await createProject(owner, 'Archived Board');
    await db
      .updateTable('project')
      .set({ archived_at: new Date() })
      .where('id', '=', archivedId)
      .execute();

    const joinedAt = new Date('2026-03-04T05:06:07.000Z');
    await db
      .insertInto('project_member')
      .values({
        project_id: ownedId,
        user_id: viewer.id,
        role: 'viewer',
        created_at: joinedAt,
      })
      .execute();

    const ownerBody = await exportBody(owner.token);
    const viewerBody = await exportBody(viewer.token);

    const ownedRow = await db
      .selectFrom('project')
      .select('created_at')
      .where('id', '=', ownedId)
      .executeTakeFirstOrThrow();

    expect(ownerBody.projects).toEqual([
      {
        id: archivedId,
        name: 'Archived Board',
        role: 'owner',
        joined_at: expect.any(String),
      },
      {
        id: ownedId,
        name: 'Owned Board',
        role: 'owner',
        joined_at: ownedRow.created_at.toISOString(),
      },
    ]);
    expect(viewerBody.projects).toEqual([
      {
        id: ownedId,
        name: 'Owned Board',
        role: 'viewer',
        joined_at: joinedAt.toISOString(),
      },
    ]);
  });

  it('exports a brand new account as itself with nothing attached to it', async () => {
    const user = await ctx.createUser('export-fresh', CHROME_UA);

    const body = await exportBody(user.token);

    expect(body.account).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_url: null,
      created_at: expect.any(String),
      email_verified_at: null,
      notification_settings: {
        task_assigned: true,
        added_to_project: true,
        bulk_task_assigned: true,
      },
    });
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]!.user_agent).toBe(CHROME_UA);
    expect(body.personal_access_tokens).toEqual([]);
    expect(body.feedback).toEqual([]);
    expect(body.projects).toEqual([]);
  });

  it('is downloadable with a personal access token', async () => {
    const user = await ctx.createUser('export-pat');
    const patToken = await createToken(user, 'pat download');

    const body = await exportBody(patToken);

    expect(body.account.id).toBe(user.id);
    expect(body.personal_access_tokens.map((token) => token.name)).toEqual(['pat download']);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await ctx.request().get('/api/auth/me/export');
    expect(res.status).toBe(401);
  });
});
