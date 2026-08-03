import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { ProjectFixtures, validDescription } from '../tasks/taskFixtures';

interface SearchResultBody {
  task_id: string;
  title: string;
  project_id: string;
  project_name: string;
  column_name: string;
}

interface SearchBody {
  results: SearchResultBody[];
  truncated: boolean;
}

function nestedDescription(text: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
          },
        ],
      },
    ],
  };
}

function mentionDescription(label: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'mention', attrs: { id: newId(), label } }],
      },
    ],
  };
}

describe('GET /api/search', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  let stranger: TestUser;

  beforeAll(async () => {
    stranger = await ctx.createUser('search-stranger');
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  // A fresh caller per test: the endpoint answers with every accessible project,
  // so a shared user would drag the previous test's fixtures into the results.
  async function newCaller(): Promise<TestUser> {
    return await ctx.createUser('search');
  }

  async function projectFor(
    owner: TestUser,
    name: string
  ): Promise<{ id: string; name: string; columnId: string; columnName: string }> {
    const id = await fixtures.createProject(name, { createdBy: owner.id });
    const columnName = 'To Do';
    const columnId = await fixtures.createColumn(id, { name: columnName });
    return { id, name, columnId, columnName };
  }

  async function search(user: TestUser, q: string): Promise<SearchBody> {
    const res = await ctx.request(user.token).get(`/api/search?q=${encodeURIComponent(q)}`);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchBody;
  }

  it('requires authentication', async () => {
    const res = await ctx.request().get('/api/search?q=anything');
    expect(res.status).toBe(401);
  });

  it('rejects a missing, blank, over-long, or control-bearing q', async () => {
    const caller = await newCaller();
    const client = ctx.request(caller.token);

    for (const path of [
      '/api/search',
      '/api/search?q=',
      '/api/search?q=%20%20',
      `/api/search?q=${'x'.repeat(201)}`,
      // A NUL reaching the driver is a 500, not a 400.
      '/api/search?q=a%00b',
    ]) {
      const res = await client.get(path);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(typeof body.error).toBe('string');
    }
  });

  it('returns matches from every accessible project with their project and column', async () => {
    const caller = await newCaller();
    const alpha = await projectFor(caller, 'Alpha board');
    const beta = await projectFor(caller, 'Beta board');
    const shipId = await fixtures.createTaskRow(
      alpha.id,
      alpha.columnId,
      'Ship the authentication rewrite'
    );
    const docsId = await fixtures.createTaskRow(beta.id, beta.columnId, 'Authentication docs');

    const body = await search(caller, 'authentication');
    const byId = new Map(body.results.map((row) => [row.task_id, row]));

    expect([...byId.keys()].sort()).toEqual([shipId, docsId].sort());
    expect(byId.get(shipId)).toMatchObject({
      title: 'Ship the authentication rewrite',
      project_id: alpha.id,
      project_name: 'Alpha board',
      column_name: alpha.columnName,
    });
    expect(byId.get(docsId)).toMatchObject({
      project_id: beta.id,
      project_name: 'Beta board',
    });
    expect(body.truncated).toBe(false);
  });

  it('matches text nested deep inside the description', async () => {
    const caller = await newCaller();
    const project = await projectFor(caller, 'Nested board');
    const taskId = await fixtures.createTaskRow(project.id, project.columnId, 'Unrelated heading', {
      description: nestedDescription('the migration checklist'),
    });

    const body = await search(caller, 'migration');
    expect(body.results.map((row) => row.task_id)).toEqual([taskId]);
  });

  it('matches a mention by the name it displays', async () => {
    const caller = await newCaller();
    const project = await projectFor(caller, 'Mention board');
    const taskId = await fixtures.createTaskRow(project.id, project.columnId, 'Review needed', {
      description: mentionDescription('Zelda Fitzgerald'),
    });

    expect((await search(caller, 'zelda')).results.map((row) => row.task_id)).toEqual([taskId]);
    expect((await search(caller, 'fitzgerald')).results.map((row) => row.task_id)).toEqual([
      taskId,
    ]);
  });

  it('does not index Tiptap structural keywords', async () => {
    const caller = await newCaller();
    const project = await projectFor(caller, 'Greeting board');
    await fixtures.createTaskRow(project.id, project.columnId, 'Greeting note', {
      description: validDescription('hello'),
    });

    expect((await search(caller, 'paragraph')).results).toEqual([]);
    expect((await search(caller, 'doc')).results).toEqual([]);
    expect((await search(caller, 'hello')).results).toHaveLength(1);
  });

  it('hides tasks in projects the caller cannot access and shows ones they are a member of', async () => {
    const caller = await newCaller();
    const secret = await projectFor(stranger, 'Stranger board');
    await fixtures.createTaskRow(secret.id, secret.columnId, 'Bluebird secret plan');

    expect((await search(caller, 'bluebird')).results).toEqual([]);

    const shared = await fixtures.createProject('Shared board', {
      createdBy: stranger.id,
      memberIds: [caller.id],
    });
    const sharedColumn = await fixtures.createColumn(shared);
    const sharedTaskId = await fixtures.createTaskRow(shared, sharedColumn, 'Bluebird shared plan');

    expect((await search(caller, 'bluebird')).results.map((row) => row.task_id)).toEqual([
      sharedTaskId,
    ]);
  });

  it('ranks a title match above a description-only match', async () => {
    const caller = await newCaller();
    const project = await projectFor(caller, 'Ranking board');
    // Seeded title-first so the `updated_at desc` tie-break argues for the
    // opposite order: only the weighting can produce the expectation below.
    const titledId = await fixtures.createTaskRow(project.id, project.columnId, 'Telemetry work');
    const buriedId = await fixtures.createTaskRow(project.id, project.columnId, 'Weekly review', {
      description: validDescription('the telemetry rollout is blocked'),
    });

    const body = await search(caller, 'telemetry');
    expect(body.results.map((row) => row.task_id)).toEqual([titledId, buriedId]);
  });

  it('keeps matching at every prefix of a word as it is typed', async () => {
    const caller = await newCaller();
    const project = await projectFor(caller, 'Prefix board');
    const taskId = await fixtures.createTaskRow(
      project.id,
      project.columnId,
      'Ship the authentication rewrite'
    );

    const word = 'authentication';
    const prefixes = Array.from({ length: word.length }, (_, i) => word.slice(0, i + 1));
    for (const prefix of prefixes) {
      const body = await search(caller, prefix);
      expect(
        body.results.map((row) => row.task_id),
        `q=${prefix} should still match`
      ).toEqual([taskId]);
    }
  });

  it('still matches inflections of an indexed word', async () => {
    const caller = await newCaller();
    const project = await projectFor(caller, 'Stemming board');
    const taskId = await fixtures.createTaskRow(
      project.id,
      project.columnId,
      'Ship the authentication rewrite'
    );

    for (const q of ['authentications', 'authenticating', 'rewrites']) {
      const body = await search(caller, q);
      expect(
        body.results.map((row) => row.task_id),
        `q=${q}`
      ).toEqual([taskId]);
    }
  });

  it('accepts a single character and matches every word starting with it', async () => {
    const caller = await newCaller();
    const project = await projectFor(caller, 'One character board');
    const quailId = await fixtures.createTaskRow(project.id, project.columnId, 'Quail migration');
    const quietId = await fixtures.createTaskRow(project.id, project.columnId, 'Quiet hours');
    await fixtures.createTaskRow(project.id, project.columnId, 'Heron nesting');

    const body = await search(caller, 'q');
    expect(body.results.map((row) => row.task_id).sort()).toEqual([quailId, quietId].sort());
    expect(body.truncated).toBe(false);
  });

  it('matches prefixes that are English stopwords', async () => {
    const caller = await newCaller();
    const project = await projectFor(caller, 'Stopword board');
    const taskId = await fixtures.createTaskRow(project.id, project.columnId, 'Theme polish');

    for (const q of ['th', 'the', 'them', 'theme']) {
      const body = await search(caller, q);
      expect(
        body.results.map((row) => row.task_id),
        `q=${q}`
      ).toEqual([taskId]);
    }
  });

  it('requires every word to match', async () => {
    const caller = await newCaller();
    const project = await projectFor(caller, 'And board');
    await fixtures.createTaskRow(project.id, project.columnId, 'Ship the authentication rewrite');
    const bothId = await fixtures.createTaskRow(
      project.id,
      project.columnId,
      'Authentication docs'
    );

    const body = await search(caller, 'authentication docs');
    expect(body.results.map((row) => row.task_id)).toEqual([bothId]);
  });

  it('answers 200 with no results for a query holding no searchable words', async () => {
    const caller = await newCaller();
    const project = await projectFor(caller, 'Punctuation board');
    await fixtures.createTaskRow(project.id, project.columnId, 'Anything at all');

    for (const q of ['&&&', '!!! ???']) {
      expect(await search(caller, q), `q=${q}`).toEqual({ results: [], truncated: false });
    }
  });

  it('caps results and reports truncation', async () => {
    const caller = await newCaller();
    const project = await projectFor(caller, 'Cap board');
    for (let i = 0; i < 50; i++) {
      await fixtures.createTaskRow(project.id, project.columnId, `Sequoia task ${i}`);
    }

    const exact = await search(caller, 'sequoia');
    expect(exact.results).toHaveLength(50);
    expect(exact.truncated).toBe(false);

    await fixtures.createTaskRow(project.id, project.columnId, 'Sequoia task 50');

    const over = await search(caller, 'sequoia');
    expect(over.results).toHaveLength(50);
    expect(over.truncated).toBe(true);
  });

  it('excludes archived cards', async () => {
    const caller = await newCaller();
    const project = await projectFor(caller, 'Archive board');
    const liveId = await fixtures.createTaskRow(project.id, project.columnId, 'Kestrel live');
    await fixtures.createTaskRow(project.id, project.columnId, 'Kestrel archived', {
      archivedAt: new Date(),
    });

    expect((await search(caller, 'kestrel')).results.map((row) => row.task_id)).toEqual([liveId]);
  });

  it('excludes tasks in archived projects', async () => {
    const caller = await newCaller();
    const live = await projectFor(caller, 'Live board');
    const liveId = await fixtures.createTaskRow(live.id, live.columnId, 'Marmot plan');

    const archived = await fixtures.createProject('Archived board', {
      createdBy: caller.id,
      archivedAt: new Date(),
    });
    const archivedColumn = await fixtures.createColumn(archived);
    await fixtures.createTaskRow(archived, archivedColumn, 'Marmot retrospective');

    expect((await search(caller, 'marmot')).results.map((row) => row.task_id)).toEqual([liveId]);
  });

  it('reflects task writes immediately', async () => {
    const caller = await newCaller();
    const createRes = await ctx
      .request(caller.token)
      .post('/api/projects', { id: newId(), name: 'Freshness board' });
    expect(createRes.status).toBe(201);
    const board = (await createRes.json()) as {
      project: { id: string };
      columns: Array<{ id: string; name: string }>;
    };
    const projectId = board.project.id;
    const columnId = board.columns[0]!.id;

    const taskId = newId();
    const post = await ctx.request(caller.token).post('/api/tasks', {
      id: taskId,
      project_id: projectId,
      column_id: columnId,
      title: 'Pelican onboarding',
      position: 1000,
    });
    expect(post.status).toBe(201);
    expect((await search(caller, 'pelican')).results.map((row) => row.task_id)).toEqual([taskId]);

    const rename = await ctx
      .request(caller.token)
      .patch(`/api/tasks/${taskId}`, { title: 'Cormorant onboarding' });
    expect(rename.status).toBe(200);
    expect((await search(caller, 'pelican')).results).toEqual([]);
    expect((await search(caller, 'cormorant')).results.map((row) => row.task_id)).toEqual([taskId]);

    const describe = await ctx
      .request(caller.token)
      .patch(`/api/tasks/${taskId}`, { description: validDescription('nesting on the estuary') });
    expect(describe.status).toBe(200);
    expect((await search(caller, 'estuary')).results.map((row) => row.task_id)).toEqual([taskId]);

    const archive = await ctx.request(caller.token).post(`/api/tasks/${taskId}/archive`);
    expect(archive.status).toBe(200);
    expect((await search(caller, 'cormorant')).results).toEqual([]);

    const remove = await ctx.request(caller.token).delete(`/api/tasks/${taskId}`);
    expect(remove.status).toBe(204);
    expect((await search(caller, 'cormorant')).results).toEqual([]);

    await db.deleteFrom('project').where('id', '=', projectId).execute();
  });
});
