import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { isValidSortKey } from '../../../src/services/sortKey';

// `position` is gone, so the invariant is the key's own: every row in a scope
// carries a valid key, and no two share one.
const SCOPES = [
  { table: 'task', group: 'column_id' },
  { table: 'board_column', group: 'project_id' },
  { table: 'checklist_item', group: 'task_id' },
  { table: 'project_user_position', group: 'user_id' },
  { table: 'task_series_checklist_item', group: 'series_id' },
] as const;

async function assertEveryRowRanked(label: string): Promise<void> {
  for (const scope of SCOPES) {
    const { rows } = await sql<{ group: string; sort_key: string }>`
      select ${sql.ref(scope.group)} as "group", sort_key
      from ${sql.ref(scope.table)}
    `.execute(db);

    const seen = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!isValidSortKey(row.sort_key)) {
        throw new Error(`${label}: ${scope.table} row in ${row.group} has key ${row.sort_key}`);
      }
      const keys = seen.get(row.group) ?? new Set<string>();
      if (keys.has(row.sort_key)) {
        throw new Error(`${label}: ${scope.table} scope ${row.group} repeats ${row.sort_key}`);
      }
      keys.add(row.sort_key);
      seen.set(row.group, keys);
    }
  }
}

describe('sort key invariants across the API', () => {
  const ctx = new TestContext();
  let owner: TestUser;
  let projectId: string;
  let columnId: string;
  let otherColumnId: string;

  async function createTask(id = newId()): Promise<string> {
    const res = await ctx
      .request(owner.token)
      .post('/api/tasks', { id, project_id: projectId, column_id: columnId, title: `card ${id}` });
    expect(res.status).toBe(201);
    return id;
  }

  beforeAll(async () => {
    owner = await ctx.createUser('sortkey');
    projectId = newId();
    expect(
      (await ctx.request(owner.token).post('/api/projects', { id: projectId, name: 'Sort keys' }))
        .status
    ).toBe(201);
    const payload = await ctx.request(owner.token).get(`/api/projects/${projectId}`);
    const board = (await payload.json()) as { columns: { id: string }[] };
    columnId = board.columns[0]!.id;
    otherColumnId = board.columns[1]!.id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('ranks a default board on creation', async () => {
    await assertEveryRowRanked('after project create');
  });

  it('ranks cards as they are created, moved and reordered', async () => {
    const first = await createTask();
    const second = await createTask();
    await assertEveryRowRanked('after creates');

    const moved = await ctx
      .request(owner.token)
      .patch(`/api/tasks/${second}`, { column_id: otherColumnId });
    expect(moved.status).toBe(200);
    await assertEveryRowRanked('after a move across columns');

    const third = await createTask();
    const reorder = await ctx
      .request(owner.token)
      .post(`/api/columns/${columnId}/reorder`, { task_ids: [third, first] });
    expect(reorder.status).toBe(200);
    await assertEveryRowRanked('after a one-shot reorder');
  });

  it('ranks a batch, its checklist and a duplicate', async () => {
    const batch = await ctx.request(owner.token).post('/api/tasks/batch', {
      project_id: projectId,
      column_id: columnId,
      tasks: [
        { id: newId(), title: 'a' },
        { id: newId(), title: 'b' },
      ],
    });
    expect(batch.status).toBe(201);
    await assertEveryRowRanked('after a batch create');

    const taskId = await createTask();
    for (const text of ['one', 'two', 'three']) {
      const item = await ctx
        .request(owner.token)
        .post('/api/checklist-items', { id: newId(), task_id: taskId, text });
      expect(item.status).toBe(201);
    }
    await assertEveryRowRanked('after checklist items');

    const duplicate = await ctx
      .request(owner.token)
      .post(`/api/tasks/${taskId}/duplicate`, { id: newId() });
    expect(duplicate.status).toBe(201);
    await assertEveryRowRanked('after a duplicate');
  });

  it("ranks a new column and the caller's project order", async () => {
    const column = await ctx
      .request(owner.token)
      .post('/api/columns', { id: newId(), project_id: projectId, name: 'Extra' });
    expect(column.status).toBe(201);
    await assertEveryRowRanked('after a column create');

    const board = await ctx.request(owner.token).get(`/api/projects/${projectId}`);
    const columns = ((await board.json()) as { columns: { sort_key: string }[] }).columns;
    const position = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/position`, { sort_key: columns[0]!.sort_key });
    expect(position.status).toBe(204);
    await assertEveryRowRanked('after a project position');
  });
});
