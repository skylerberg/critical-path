import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import { displayTitle } from '../../src/output';
import { decodeId, encodeId, slugify } from '../../src/short-links';
import { TASK_TITLE_MAX_LENGTH } from '../../../src/schemas/tasks';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardResponse'];
type BoardTask = components['schemas']['BoardTask'];
type TaskDetailResponse = components['schemas']['TaskDetailResponse'];
type StatefulTask = BoardTask & { state: string };

describe('task commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let projectId: string;
  let backlogId: string;
  let todoId: string;
  let doneId: string;
  let alpha: BoardTask;
  let beta: BoardTask;
  let gamma: BoardTask;
  let delta: BoardTask;
  let epsilon: BoardTask;
  const blockerWorkId = crypto.randomUUID();
  const blockedWorkId = crypto.randomUUID();
  const finishedWorkId = crypto.randomUUID();

  beforeAll(async () => {
    user = await tc.createUser('cli-task');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const create = await tc.request(user.token).post('/api/projects', {
      id: crypto.randomUUID(),
      name: 'CLI Task Fixture',
    });
    expect(create.status).toBe(201);
    const board = (await create.json()) as BoardPayload;
    projectId = board.project.id;
    const columns = [...board.columns].sort((a, b) => (a.sort_key < b.sort_key ? -1 : 1));
    backlogId = columns[0].id;
    todoId = columns[1].id;
    doneId = columns.find((c) => c.is_done)!.id;

    // Nine tests below address these five cards, so they are built here rather
    // than in the first test: a create that breaks then fails this hook once,
    // instead of leaving every later test to fail on an undefined id.
    const createCard = async (title: string, ...placement: string[]): Promise<BoardTask> => {
      const res = await h.runCli([
        'task',
        'create',
        title,
        '--project',
        projectId,
        ...placement,
        '--json',
      ]);
      expect(res.exitCode).toBe(0);
      return res.json<BoardTask>();
    };

    alpha = await createCard('Alpha task');
    beta = await createCard('Beta task');
    gamma = await createCard('Gamma task', '--top');
    delta = await createCard('Delta task', '--before', 'Beta task');
    epsilon = await createCard('Epsilon task', '--after', 'Gamma task');
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  it('create defaults to the first non-done column and honors placement flags', async () => {
    expect(alpha.column_id).toBe(backlogId);
    expect(alpha.sort_key).toBeTruthy();
    expect(beta.sort_key > alpha.sort_key).toBe(true);
    expect(gamma.sort_key < alpha.sort_key).toBe(true);
    expect(delta.sort_key > alpha.sort_key && delta.sort_key < beta.sort_key).toBe(true);
    expect(epsilon.sort_key > gamma.sort_key && epsilon.sort_key < alpha.sort_key).toBe(true);

    const list = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--column',
      backlogId,
      '--json',
    ]);
    expect(list.exitCode).toBe(0);
    const ids = list.json<StatefulTask[]>().map((t) => t.id);
    expect(ids).toEqual([gamma.id, epsilon.id, alpha.id, delta.id, beta.id]);
  });

  it('create resolves labels and assignees', async () => {
    const labelId = crypto.randomUUID();
    const label = await tc.request(user.token).post('/api/labels', {
      id: labelId,
      project_id: projectId,
      name: 'bug',
      color: '#ff0000',
    });
    expect(label.status).toBe(201);

    const res = await h.runCli([
      'task',
      'create',
      'Labeled task',
      '--project',
      projectId,
      '--label',
      'bug',
      '--assignee',
      user.name,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    const created = res.json<BoardTask>();
    expect(created.label_ids).toEqual([labelId]);
    expect(created.assignee_ids).toEqual([user.id]);
  });

  it('list filters AND-compose', async () => {
    const client = tc.request(user.token);
    for (const [id, title, column, position] of [
      [blockerWorkId, 'Blocker work', todoId, 1000],
      [blockedWorkId, 'Blocked work', todoId, 2000],
      [finishedWorkId, 'Finished work', doneId, 1000],
    ] as const) {
      const res = await client.post('/api/tasks', {
        id,
        project_id: projectId,
        column_id: column,
        title,
        position,
      });
      expect(res.status).toBe(201);
    }
    const block = await client.post(`/api/tasks/${blockedWorkId}/blockers`, {
      blocker_task_id: blockerWorkId,
    });
    expect(block.status).toBe(204);

    const blocked = await h.runCli(['task', 'list', '--project', projectId, '--blocked', '--json']);
    const blockedIds = blocked.json<StatefulTask[]>().map((t) => t.id);
    expect(blockedIds).toEqual([blockedWorkId]);
    expect(blocked.json<StatefulTask[]>()[0].state).toBe('blocked');

    const ready = await h.runCli(['task', 'list', '--project', projectId, '--ready', '--json']);
    const readyIds = ready.json<StatefulTask[]>().map((t) => t.id);
    expect(readyIds).toContain(blockerWorkId);
    expect(readyIds).not.toContain(blockedWorkId);
    expect(readyIds).not.toContain(finishedWorkId);

    const inColumn = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--column',
      todoId,
      '--json',
    ]);
    expect(inColumn.json<StatefulTask[]>().map((t) => t.id)).toEqual([
      blockerWorkId,
      blockedWorkId,
    ]);

    const search = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--search',
      'blocked WO',
      '--json',
    ]);
    expect(search.json<StatefulTask[]>().map((t) => t.id)).toEqual([blockedWorkId]);

    const assigned = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--assignee',
      user.name,
      '--json',
    ]);
    expect(assigned.json<StatefulTask[]>().map((t) => t.title)).toEqual(['Labeled task']);

    const done = await h.runCli(['task', 'list', '--project', projectId, '--done', '--json']);
    expect(done.json<StatefulTask[]>().map((t) => t.id)).toEqual([finishedWorkId]);

    const notDone = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--not-done',
      '--json',
    ]);
    expect(notDone.json<StatefulTask[]>().map((t) => t.id)).not.toContain(finishedWorkId);

    const composed = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--column',
      todoId,
      '--ready',
      '--json',
    ]);
    expect(composed.json<StatefulTask[]>().map((t) => t.id)).toEqual([blockerWorkId]);
  });

  it('show works by title ref and by UUID without --project', async () => {
    const byTitle = await h.runCli([
      'task',
      'show',
      'Alpha task',
      '--project',
      projectId,
      '--json',
    ]);
    expect(byTitle.exitCode).toBe(0);
    const detail = byTitle.json<TaskDetailResponse & { state: string }>();
    expect(detail.id).toBe(alpha.id);
    expect(detail.state).toBe('ready');
    expect(detail.project_id).toBe(projectId);

    const byUuid = await h.runCli(['task', 'show', alpha.id]);
    expect(byUuid.exitCode).toBe(0);
    expect(byUuid.stdout).toContain('Alpha task');
    expect(byUuid.stdout).toContain(alpha.id.slice(0, 8));
  });

  it('update changes the title and requires at least one change', async () => {
    const res = await h.runCli([
      'task',
      'update',
      'Epsilon task',
      '--project',
      projectId,
      '--title',
      'Epsilon renamed',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<BoardTask>().title).toBe('Epsilon renamed');

    const noChange = await h.runCli(['task', 'update', epsilon.id]);
    expect(noChange.exitCode).toBe(2);
  });

  it('move computes midpoint positions in the target column', async () => {
    const top = await h.runCli([
      'task',
      'move',
      'Alpha task',
      '--project',
      projectId,
      '--column',
      todoId,
      '--top',
      '--json',
    ]);
    expect(top.exitCode).toBe(0);
    const movedTop = top.json<BoardTask>();
    expect(movedTop.column_id).toBe(todoId);
    expect(movedTop.sort_key < alpha.sort_key).toBe(true);

    const between = await h.runCli([
      'task',
      'move',
      'Delta task',
      '--project',
      projectId,
      '--column',
      todoId,
      '--before',
      'Blocked work',
      '--json',
    ]);
    expect(between.exitCode).toBe(0);
    const movedBetween = between.json<BoardTask>();
    expect(movedBetween.column_id).toBe(todoId);
    expect(movedBetween.sort_key > alpha.sort_key && movedBetween.sort_key < beta.sort_key).toBe(
      true
    );
  });

  it('done moves the task to the bottom of the last done column', async () => {
    const res = await h.runCli(['task', 'done', 'Beta task', '--project', projectId, '--json']);
    expect(res.exitCode).toBe(0);
    const moved = res.json<BoardTask>();
    expect(moved.column_id).toBe(doneId);
    expect(moved.sort_key).toBeTruthy();
  });

  it('refuses to delete a task that is still on the board', async () => {
    const res = await h.runCli(['task', 'delete', 'Delta task', '--project', projectId, '--force']);
    expect(res.exitCode).toBe(6);
    expect(res.stderr).toContain('still on the board');
    expect(res.stderr).toContain('cpath task archive');

    const alive = await h.runCli(['task', 'show', delta.id, '--json']);
    expect(alive.exitCode).toBe(0);
  });

  it('delete with --force removes an archived task', async () => {
    expect((await h.runCli(['task', 'archive', delta.id])).exitCode).toBe(0);

    const res = await h.runCli([
      'task',
      'delete',
      'Delta task',
      '--project',
      projectId,
      '--force',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<{ deleted: boolean; id: string }>()).toEqual({
      deleted: true,
      id: delta.id,
    });

    const gone = await h.runCli(['task', 'show', delta.id]);
    expect(gone.exitCode).toBe(4);
  });

  it('label add, remove, and set follow read-modify-write semantics', async () => {
    const client = tc.request(user.token);
    const frontendId = crypto.randomUUID();
    const backendId = crypto.randomUUID();
    for (const [id, name, color] of [
      [frontendId, 'frontend', '#00ff00'],
      [backendId, 'backend', '#0000ff'],
    ] as const) {
      const res = await client.post('/api/labels', { id, project_id: projectId, name, color });
      expect(res.status).toBe(201);
    }

    const add = await h.runCli([
      'task',
      'label',
      'add',
      'Gamma task',
      'frontend',
      '--project',
      projectId,
      '--json',
    ]);
    expect(add.exitCode).toBe(0);
    expect(add.json<{ label_ids: string[] }>().label_ids).toEqual([frontendId]);

    const addMore = await h.runCli([
      'task',
      'label',
      'add',
      'Gamma task',
      'backend',
      '--project',
      projectId,
      '--json',
    ]);
    expect(addMore.json<{ label_ids: string[] }>().label_ids).toEqual([frontendId, backendId]);

    const remove = await h.runCli([
      'task',
      'label',
      'remove',
      'Gamma task',
      'frontend',
      '--project',
      projectId,
      '--json',
    ]);
    expect(remove.json<{ label_ids: string[] }>().label_ids).toEqual([backendId]);

    const set = await h.runCli([
      'task',
      'label',
      'set',
      'Gamma task',
      'frontend',
      'backend',
      '--project',
      projectId,
      '--json',
    ]);
    expect(set.json<{ label_ids: string[] }>().label_ids).toEqual([frontendId, backendId]);

    const clear = await h.runCli([
      'task',
      'label',
      'set',
      'Gamma task',
      '--project',
      projectId,
      '--json',
    ]);
    expect(clear.exitCode).toBe(0);
    expect(clear.json<{ label_ids: string[] }>().label_ids).toEqual([]);

    const detail = await client.get(`/api/tasks/${gamma.id}`);
    expect(((await detail.json()) as TaskDetailResponse).label_ids).toEqual([]);
  });

  it('assign and unassign resolve users by name or address', async () => {
    const assign = await h.runCli([
      'task',
      'assign',
      'Gamma task',
      user.email,
      '--project',
      projectId,
      '--json',
    ]);
    expect(assign.exitCode).toBe(0);
    expect(assign.json<{ assignee_ids: string[] }>().assignee_ids).toEqual([user.id]);

    const unassign = await h.runCli([
      'task',
      'unassign',
      'Gamma task',
      user.name,
      '--project',
      projectId,
      '--json',
    ]);
    expect(unassign.exitCode).toBe(0);
    expect(unassign.json<{ assignee_ids: string[] }>().assignee_ids).toEqual([]);

    const set = await h.runCli([
      'task',
      'assignees',
      'set',
      'Gamma task',
      user.name,
      '--project',
      projectId,
      '--json',
    ]);
    expect(set.exitCode).toBe(0);
    expect(set.json<{ assignee_ids: string[] }>().assignee_ids).toEqual([user.id]);

    const clear = await h.runCli([
      'task',
      'assignees',
      'set',
      'Gamma task',
      '--project',
      projectId,
      '--json',
    ]);
    expect(clear.exitCode).toBe(0);
    expect(clear.json<{ assignee_ids: string[] }>().assignee_ids).toEqual([]);
  });

  it('resolves a task by its short alias with no --project', async () => {
    const alias = encodeId(alpha.id);
    const show = await h.runCli(['task', 'show', alias, '--json']);
    expect(show.exitCode).toBe(0);
    expect(show.json<TaskDetailResponse>().id).toBe(alpha.id);
  });

  it('treats an alias as case sensitive rather than lowercasing it', async () => {
    const alias = encodeId(alpha.id);
    // Which letter can be flipped depends on the value: every alias begins A-H
    // because a larger leading digit would put it past the largest uuid, so
    // raising the first character yields nothing rather than something else.
    // Any flip that still names an id proves the point equally well.
    let flipped: string | null = null;
    for (let at = 0; at < alias.length && flipped === null; at++) {
      const character = alias[at]!;
      if (!/[a-z]/i.test(character)) continue;
      const swapped =
        character === character.toLowerCase() ? character.toUpperCase() : character.toLowerCase();
      const candidate = alias.slice(0, at) + swapped + alias.slice(at + 1);
      const decoded = decodeId(candidate);
      if (decoded !== null && decoded !== alpha.id) {
        flipped = candidate;
      }
    }
    expect(flipped).not.toBeNull();

    const show = await h.runCli(['task', 'show', flipped!, '--json']);
    expect(show.exitCode).toBe(4);
    expect(show.stdout).toBe('');
  });

  it('accepts an alias as a placement anchor, for --before and --after alike', async () => {
    const created = await tc.request(user.token).post('/api/projects', {
      id: crypto.randomUUID(),
      name: 'CLI Anchor Fixture',
    });
    expect(created.status).toBe(201);
    const anchorProjectId = ((await created.json()) as BoardPayload).project.id;
    try {
      const first = await h.runCli([
        'task',
        'create',
        'Anchor task',
        '--project',
        anchorProjectId,
        '--json',
      ]);
      expect(first.exitCode).toBe(0);
      const anchor = first.json<BoardTask>();

      const before = await h.runCli([
        'task',
        'create',
        'Lands before',
        '--project',
        anchorProjectId,
        '--before',
        encodeId(anchor.id),
        '--json',
      ]);
      expect(before.exitCode).toBe(0);
      expect(before.json<BoardTask>().sort_key < anchor.sort_key).toBe(true);

      const after = await h.runCli([
        'task',
        'create',
        'Lands after',
        '--project',
        anchorProjectId,
        '--after',
        encodeId(anchor.id),
        '--json',
      ]);
      expect(after.exitCode).toBe(0);
      expect(after.json<BoardTask>().sort_key > anchor.sort_key).toBe(true);

      const moved = await h.runCli([
        'task',
        'move',
        'Lands after',
        '--project',
        anchorProjectId,
        '--before',
        encodeId(anchor.id),
        '--json',
      ]);
      expect(moved.exitCode).toBe(0);
      expect(moved.json<BoardTask>().sort_key < anchor.sort_key).toBe(true);
    } finally {
      await tc.request(user.token).delete(`/api/projects/${anchorProjectId}`);
    }
  });

  it('rejects a non-canonical spelling of an alias', async () => {
    const alias = encodeId(alpha.id);
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const variant = alias.slice(0, 21) + ALPHABET[ALPHABET.indexOf(alias[21]) + 1];
    const show = await h.runCli(['task', 'show', variant, '--json']);
    expect(show.exitCode).not.toBe(0);
  });

  it('leaves a title that is shaped like an alias reachable by that title', async () => {
    // Decodes to a valid uuid, which is what lets a decode shadow a title.
    const title = 'ArchivedRoadmapQ3Notes';
    expect(decodeId(title)).not.toBeNull();
    const created = await tc.request(user.token).post('/api/projects', {
      id: crypto.randomUUID(),
      name: 'CLI Alias Title Fixture',
    });
    expect(created.status).toBe(201);
    const fixtureId = ((await created.json()) as BoardPayload).project.id;
    try {
      const made = await h.runCli(['task', 'create', title, '--project', fixtureId, '--json']);
      expect(made.exitCode).toBe(0);
      const target = made.json<BoardTask>();

      const show = await h.runCli(['task', 'show', title, '--project', fixtureId, '--json']);
      expect(show.exitCode).toBe(0);
      expect(show.json<TaskDetailResponse>().id).toBe(target.id);

      const url = await h.runCli(['task', 'url', title, '--project', fixtureId, '--json']);
      expect(url.exitCode).toBe(0);
      expect(url.json<{ url: string }>().url).toContain(`/t/${encodeId(target.id)}/`);

      const comment = await h.runCli([
        'comment',
        'add',
        title,
        'Reachable by title',
        '--project',
        fixtureId,
        '--json',
      ]);
      expect(comment.exitCode).toBe(0);

      const update = await h.runCli([
        'task',
        'update',
        title,
        '--project',
        fixtureId,
        '--title',
        'Renamed by title',
        '--json',
      ]);
      expect(update.exitCode).toBe(0);
      expect(update.json<BoardTask>().id).toBe(target.id);
    } finally {
      await tc.request(user.token).delete(`/api/projects/${fixtureId}`);
    }
  });

  it('gives an alias to the task it names, not to a card titled that alias', async () => {
    const alias = encodeId(alpha.id);
    const decoy = await h.runCli(['task', 'create', alias, '--project', projectId, '--json']);
    expect(decoy.exitCode).toBe(0);
    const decoyId = decoy.json<BoardTask>().id;
    try {
      const show = await h.runCli(['task', 'show', alias, '--project', projectId, '--json']);
      expect(show.exitCode).toBe(0);
      expect(show.json<TaskDetailResponse>().id).toBe(alpha.id);

      const url = await h.runCli(['task', 'url', alias, '--project', projectId, '--json']);
      expect(url.exitCode).toBe(0);
      expect(url.json<{ url: string }>().url).toContain(`/t/${alias}/`);
    } finally {
      await h.runCli(['task', 'archive', decoyId]);
      await h.runCli(['task', 'delete', decoyId, '--force']);
    }
  });

  it('quotes the ref when an alias names no task and no project can be searched', async () => {
    const alias = encodeId(crypto.randomUUID());
    const show = await h.runCli(['task', 'show', alias]);
    expect(show.exitCode).toBe(4);
    expect(show.stderr).toContain(`No task matching "${alias}"`);

    const url = await h.runCli(['task', 'url', alias]);
    expect(url.exitCode).toBe(4);
    expect(url.stderr).toContain(`No task matching "${alias}"`);
  });

  it('url prints the canonical web URL, and --json carries the same string', async () => {
    const expected = `https://criticalpath.skylerberg.com/t/${encodeId(alpha.id)}/${slugify(alpha.title)}`;

    const human = await h.runCli(['task', 'url', 'Alpha task', '--project', projectId]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout.trim()).toBe(expected);

    const json = await h.runCli(['task', 'url', 'Alpha task', '--project', projectId, '--json']);
    expect(json.json<{ url: string }>().url).toBe(expected);
  });

  it('url honors a configured web-url and resolves an alias ref', async () => {
    const set = await h.runCli(['config', 'set', 'web-url', 'https://cp.example.test/']);
    expect(set.exitCode).toBe(0);
    try {
      const res = await h.runCli(['task', 'url', encodeId(alpha.id)]);
      expect(res.exitCode).toBe(0);
      expect(res.stdout.trim()).toBe(
        `https://cp.example.test/t/${encodeId(alpha.id)}/${slugify(alpha.title)}`
      );
    } finally {
      await h.runCli(['config', 'unset', 'web-url']);
    }
  });

  it('url holds the environment to the same rules as the stored value', async () => {
    const alias = encodeId(alpha.id);
    for (const base of ['not a url', 'cp.example.test', 'https://user:pw@cp.example.test']) {
      const res = await h.runCli(['task', 'url', alias], {
        env: { CRITICAL_PATH_WEB_URL: base },
      });
      expect(res.exitCode).toBe(2);
      expect(res.stdout).toBe('');
    }

    const ok = await h.runCli(['task', 'url', alias], {
      env: { CRITICAL_PATH_WEB_URL: 'https://cp.example.test/' },
    });
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.trim()).toBe(`https://cp.example.test/t/${alias}/${slugify(alpha.title)}`);
  });

  it('archive, archived, restore and show address a card the board no longer holds', async () => {
    const created = await h.runCli([
      'task',
      'create',
      'Shelved work',
      '--project',
      projectId,
      '--json',
    ]);
    expect(created.exitCode).toBe(0);
    const shelved = created.json<BoardTask>();

    const archive = await h.runCli([
      'task',
      'archive',
      'Shelved work',
      '--project',
      projectId,
      '--json',
    ]);
    expect(archive.exitCode).toBe(0);
    expect(archive.json<{ id: string; archived_at: string }>().id).toBe(shelved.id);

    const list = await h.runCli(['task', 'list', '--project', projectId, '--json']);
    expect(list.json<StatefulTask[]>().map((t) => t.title)).not.toContain('Shelved work');

    const archived = await h.runCli(['task', 'archived', '--project', projectId, '--json']);
    expect(archived.exitCode).toBe(0);
    const archivedRows = archived.json<Array<{ id: string; archived_at: string }>>();
    expect(archivedRows.map((t) => t.id)).toContain(shelved.id);
    expect(typeof archivedRows.find((t) => t.id === shelved.id)!.archived_at).toBe('string');

    const table = await h.runCli(['task', 'archived', '--project', projectId]);
    expect(table.stdout).toContain('ARCHIVED');
    expect(table.stdout).toContain('Shelved work');

    const filtered = await h.runCli([
      'task',
      'archived',
      '--project',
      projectId,
      '--search',
      'no-such-title',
    ]);
    expect(filtered.stdout).toContain('No archived tasks');

    const show = await h.runCli(['task', 'show', 'Shelved work', '--project', projectId]);
    expect(show.exitCode).toBe(0);
    expect(show.stdout).toContain('Archived:');

    // An alias names the card outright, so it still resolves once the board no
    // longer lists it — which is what a months-old pasted link relies on.
    const byAlias = await h.runCli(['task', 'show', encodeId(shelved.id), '--json']);
    expect(byAlias.exitCode).toBe(0);
    expect(byAlias.json<TaskDetailResponse>().id).toBe(shelved.id);

    const url = await h.runCli(['task', 'url', encodeId(shelved.id)]);
    expect(url.exitCode).toBe(0);
    expect(url.stdout.trim()).toContain(`/t/${encodeId(shelved.id)}/`);

    const move = await h.runCli([
      'task',
      'move',
      'Shelved work',
      '--project',
      projectId,
      '--column',
      todoId,
    ]);
    expect(move.exitCode).toBe(4);
    expect(move.stderr).toContain('No task matching');

    const update = await h.runCli(['task', 'update', shelved.id, '--title', 'Renamed']);
    expect(update.exitCode).toBe(4);
    expect(update.stderr).toContain('No task matching');

    const restore = await h.runCli([
      'task',
      'restore',
      'Shelved work',
      '--project',
      projectId,
      '--json',
    ]);
    expect(restore.exitCode).toBe(0);
    expect(restore.json<BoardTask>().id).toBe(shelved.id);

    const back = await h.runCli(['task', 'list', '--project', projectId, '--json']);
    expect(back.json<StatefulTask[]>().map((t) => t.title)).toContain('Shelved work');
  });

  it('delete by title reaches an archived card', async () => {
    const created = await h.runCli([
      'task',
      'create',
      'Doomed archive',
      '--project',
      projectId,
      '--json',
    ]);
    const doomed = created.json<BoardTask>();
    expect((await h.runCli(['task', 'archive', doomed.id])).exitCode).toBe(0);

    const res = await h.runCli([
      'task',
      'delete',
      'Doomed archive',
      '--project',
      projectId,
      '--force',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<{ deleted: boolean; id: string }>()).toEqual({ deleted: true, id: doomed.id });

    const archived = await h.runCli(['task', 'archived', '--project', projectId, '--json']);
    expect(archived.json<Array<{ id: string }>>().map((t) => t.id)).not.toContain(doomed.id);
  });

  it('clips a long title in scanning output but never in --json or the detail view', async () => {
    const title = `Long ${'w'.repeat(TASK_TITLE_MAX_LENGTH - 5)}`;
    const created = await h.runCli(['task', 'create', title, '--project', projectId, '--json']);
    expect(created.exitCode).toBe(0);
    const task = created.json<BoardTask>();
    expect(task.title).toBe(title);

    const list = await h.runCli(['task', 'list', '--project', projectId]);
    expect(list.stdout).toContain(displayTitle(title));
    expect(list.stdout).not.toContain(title);

    const asJson = await h.runCli(['task', 'list', '--project', projectId, '--json']);
    expect(asJson.json<StatefulTask[]>().map((t) => t.title)).toContain(title);

    const show = await h.runCli(['task', 'show', task.id]);
    expect(show.stdout).toContain(title);

    await h.runCli(['task', 'archive', task.id]);
    await h.runCli(['task', 'delete', task.id, '--force']);
  });

  it('ambiguous title refs exit 2', async () => {
    for (const title of ['Zeta duplicate one', 'Zeta duplicate two']) {
      const res = await h.runCli(['task', 'create', title, '--project', projectId]);
      expect(res.exitCode).toBe(0);
    }
    const res = await h.runCli(['task', 'show', 'zeta duplicate', '--project', projectId]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('Ambiguous');
  });

  it('conflicting placement flags exit 2', async () => {
    const res = await h.runCli([
      'task',
      'create',
      'Conflicting placement',
      '--project',
      projectId,
      '--top',
      '--bottom',
    ]);
    expect(res.exitCode).toBe(2);
  });

  it('sets, shows, changes and clears a due date', async () => {
    const created = await h.runCli([
      'task',
      'create',
      'Dated task',
      '--project',
      projectId,
      '--due',
      '2026-08-03',
      '--json',
    ]);
    expect(created.exitCode).toBe(0);
    const dated = created.json<BoardTask>();
    expect(dated.due_date).toBe('2026-08-03');

    const shown = await h.runCli(['task', 'show', dated.id]);
    expect(shown.stdout).toContain('Due:       2026-08-03');

    const changed = await h.runCli(['task', 'update', dated.id, '--due', '2026-09-01', '--json']);
    expect(changed.exitCode).toBe(0);
    expect(changed.json<BoardTask>().due_date).toBe('2026-09-01');

    const cleared = await h.runCli(['task', 'update', dated.id, '--clear-due', '--json']);
    expect(cleared.exitCode).toBe(0);
    expect(cleared.json<BoardTask>().due_date).toBeNull();

    const undated = await h.runCli(['task', 'show', dated.id]);
    expect(undated.stdout).not.toContain('Due:');
  });

  it('rejects a due date it cannot parse rather than guessing', async () => {
    const created = await h.runCli([
      'task',
      'create',
      'Never created',
      '--project',
      projectId,
      '--due',
      'tomorrow',
    ]);
    expect(created.exitCode).toBe(6);
    expect(created.stderr).toContain('YYYY-MM-DD');

    const conflicting = await h.runCli([
      'task',
      'update',
      'Alpha task',
      '--project',
      projectId,
      '--due',
      '2026-09-01',
      '--clear-due',
    ]);
    expect(conflicting.exitCode).toBe(2);
  });
});

describe('task create - (one title per stdin line)', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let projectId: string;
  let backlogId: string;
  let todoId: string;

  beforeAll(async () => {
    user = await tc.createUser('cli-task-bulk');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const create = await tc.request(user.token).post('/api/projects', {
      id: crypto.randomUUID(),
      name: 'CLI Bulk Fixture',
    });
    expect(create.status).toBe(201);
    const board = (await create.json()) as BoardPayload;
    projectId = board.project.id;
    const columns = [...board.columns].sort((a, b) => (a.sort_key < b.sort_key ? -1 : 1));
    backlogId = columns[0].id;
    todoId = columns[1].id;
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  it('creates one task per non-blank line, in order, in the default column', async () => {
    const seed = await h.runCli(['task', 'create', 'Seeded', '--project', projectId, '--json']);
    expect(seed.exitCode).toBe(0);
    const seeded = seed.json<BoardTask>();

    const res = await h.runCli(['task', 'create', '-', '--project', projectId, '--json'], {
      stdin: 'One\r\nTwo\n\n  Three  \n',
    });
    expect(res.exitCode).toBe(0);
    const created = res.json<BoardTask[]>();
    expect(created.map((t) => t.title)).toEqual(['One', 'Two', 'Three']);
    expect(created.every((t) => t.column_id === backlogId)).toBe(true);
    expect(created.every((t, i) => i === 0 || t.sort_key > created[i - 1].sort_key)).toBe(true);
    expect(created[0].sort_key > seeded.sort_key).toBe(true);

    const list = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--column',
      backlogId,
      '--json',
    ]);
    expect(list.json<StatefulTask[]>().map((t) => t.title)).toEqual([
      'Seeded',
      'One',
      'Two',
      'Three',
    ]);
  });

  it('sends one request for the whole batch', async () => {
    const paths: string[] = [];
    const res = await h.runCli(['task', 'create', '-', '--project', projectId, '--json'], {
      stdin: 'Batched one\nBatched two\nBatched three\n',
      onRequest: (request) => {
        if (request.method === 'POST') {
          paths.push(new URL(request.url).pathname);
        }
      },
    });
    expect(res.exitCode).toBe(0);
    expect(paths).toEqual(['/api/tasks/batch']);
  });

  it('honors --column and --top', async () => {
    const seed = await h.runCli([
      'task',
      'create',
      'Anchor',
      '--project',
      projectId,
      '--column',
      todoId,
      '--json',
    ]);
    const anchor = seed.json<BoardTask>();

    const res = await h.runCli(
      ['task', 'create', '-', '--project', projectId, '--column', todoId, '--top', '--json'],
      { stdin: 'Top one\nTop two\nTop three\n' }
    );
    expect(res.exitCode).toBe(0);
    const created = res.json<BoardTask[]>();
    expect(created.map((t) => t.title)).toEqual(['Top one', 'Top two', 'Top three']);
    expect(created.every((t) => t.column_id === todoId)).toBe(true);
    expect(created.every((t, i) => i === 0 || t.sort_key > created[i - 1].sort_key)).toBe(true);
    expect(created[2].sort_key < anchor.sort_key).toBe(true);

    const list = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--column',
      todoId,
      '--json',
    ]);
    expect(list.json<StatefulTask[]>().map((t) => t.title)).toEqual([
      'Top one',
      'Top two',
      'Top three',
      'Anchor',
    ]);
  });

  it('prints a table of what it created without --json', async () => {
    const res = await h.runCli(['task', 'create', '-', '--project', projectId], {
      stdin: 'Tabled one\nTabled two\n',
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Created 2 tasks in');
    expect(res.stdout).toContain('Tabled one');
    expect(res.stdout).toContain('Tabled two');

    const one = await h.runCli(['task', 'create', '-', '--project', projectId], {
      stdin: 'Tabled alone\n',
    });
    expect(one.exitCode).toBe(0);
    expect(one.stdout).toContain('Created 1 task in');
  });

  it('fails with exit 2 instead of draining a terminal', async () => {
    const requests: string[] = [];
    const res = await h.runCli(['task', 'create', '-', '--project', projectId], {
      stdinIsTty: true,
      onRequest: (request) => requests.push(new URL(request.url).pathname),
    });
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('Pipe one title per line');
    expect(requests).toEqual([]);
  });

  it('fails with exit 2 on empty stdin', async () => {
    const res = await h.runCli(['task', 'create', '-', '--project', projectId], {
      stdin: '\n  \n',
    });
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('No task titles');
  });

  it('fails with exit 2 when combined with options the batch cannot carry', async () => {
    for (const extra of [
      ['--label', 'bug'],
      ['--assignee', user.name],
      ['--description', 'nope'],
      ['--due', '2026-09-01'],
    ]) {
      const res = await h.runCli(['task', 'create', '-', '--project', projectId, ...extra], {
        stdin: 'One\nTwo\n',
      });
      expect(res.exitCode, extra[0]).toBe(2);
      expect(res.stderr, extra[0]).toContain(extra[0]);
    }
  });

  it('rejects more than 100 titles without calling the API', async () => {
    const titles = Array.from({ length: 101 }, (_, i) => `Over cap ${i}`);
    const requests: string[] = [];
    const res = await h.runCli(['task', 'create', '-', '--project', projectId], {
      stdin: `${titles.join('\n')}\n`,
      onRequest: (request) => requests.push(new URL(request.url).pathname),
    });
    expect(res.exitCode).toBe(6);
    expect(res.stderr).toContain('at most 100');
    expect(requests).toEqual([]);

    const list = await h.runCli(['task', 'list', '--project', projectId, '--json']);
    expect(list.json<StatefulTask[]>().some((t) => t.title.startsWith('Over cap'))).toBe(false);
  });
});

describe('task duplicate', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let projectId: string;
  let columnId: string;

  beforeAll(async () => {
    user = await tc.createUser('cli-task-duplicate');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const create = await tc.request(user.token).post('/api/projects', {
      id: crypto.randomUUID(),
      name: 'CLI Duplicate Fixture',
    });
    expect(create.status).toBe(201);
    const board = (await create.json()) as BoardPayload;
    projectId = board.project.id;
    columnId = [...board.columns].sort((a, b) => (a.sort_key < b.sort_key ? -1 : 1))[0].id;
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  async function createTask(title: string): Promise<BoardTask> {
    const res = await h.runCli([
      'task',
      'create',
      title,
      '--project',
      projectId,
      '--column',
      columnId,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    return res.json<BoardTask>();
  }

  it('places the copy between the original and the next card', async () => {
    const first = await createTask('Duplicate me');
    const second = await createTask('Next card');

    const res = await h.runCli([
      'task',
      'duplicate',
      'Duplicate me',
      '--project',
      projectId,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    const copy = res.json<BoardTask>();
    expect(copy.id).not.toBe(first.id);
    expect(copy.title).toBe('Duplicate me');
    expect(copy.column_id).toBe(columnId);
    expect(copy.sort_key > first.sort_key).toBe(true);
    expect(copy.sort_key < second.sort_key).toBe(true);

    const list = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--column',
      columnId,
      '--json',
    ]);
    expect(list.json<StatefulTask[]>().map((t) => t.title)).toEqual([
      'Duplicate me',
      'Duplicate me',
      'Next card',
    ]);
  });

  it('appends when the original is last, resolving by id prefix', async () => {
    const last = await createTask('Last card');

    const res = await h.runCli([
      'task',
      'duplicate',
      last.id.slice(0, 8),
      '--project',
      projectId,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    const copy = res.json<BoardTask>();
    expect(copy.sort_key > last.sort_key).toBe(true);
    expect(copy.title).toBe('Last card');
  });

  it('reports the copy without --json', async () => {
    const source = await createTask('Printed card');
    const res = await h.runCli(['task', 'duplicate', source.id]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Duplicated task "Printed card"');
  });

  it('duplicates an archived card into a live one at the end of its column', async () => {
    const source = await createTask('Archived original');
    const archive = await h.runCli(['task', 'archive', source.id, '--json']);
    expect(archive.exitCode).toBe(0);

    const res = await h.runCli(['task', 'duplicate', source.id, '--json']);
    expect(res.exitCode).toBe(0);
    const copy = res.json<BoardTask>();
    expect(copy.id).not.toBe(source.id);
    expect(copy.title).toBe('Archived original');
    expect(copy.column_id).toBe(columnId);

    const live = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--column',
      columnId,
      '--json',
    ]);
    const titles = live.json<StatefulTask[]>().map((t) => t.title);
    expect(titles.filter((t) => t === 'Archived original')).toHaveLength(1);
    expect(titles[titles.length - 1]).toBe('Archived original');
  });

  it('exits 4 for an unknown ref and 2 for an ambiguous one', async () => {
    const unknown = await h.runCli(['task', 'duplicate', 'no such card', '--project', projectId]);
    expect(unknown.exitCode).toBe(4);

    const ambiguous = await h.runCli(['task', 'duplicate', 'duplicate me', '--project', projectId]);
    expect(ambiguous.exitCode).toBe(2);
    expect(ambiguous.stderr).toContain('Ambiguous');
  });
});
