import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { isValidSortKey } from '../../../src/services/sortKey';

// While `position` is still the ordering the reads use, the two must agree
// everywhere: the release that flips reads to sort_key has to find keys the
// release before it already maintained.
const SCOPES = [
  { table: 'task', group: 'column_id', tiebreak: 'id' },
  { table: 'board_column', group: 'project_id', tiebreak: 'id' },
  { table: 'checklist_item', group: 'task_id', tiebreak: 'id' },
  { table: 'project_user_position', group: 'user_id', tiebreak: 'project_id' },
  { table: 'task_series_checklist_item', group: 'series_id', tiebreak: 'id' },
] as const;

async function assertKeysMatchPositions(label: string): Promise<void> {
  for (const scope of SCOPES) {
    const { rows } = await sql<{ group: string; sort_key: string | null }>`
      select ${sql.ref(scope.group)} as "group", sort_key
      from ${sql.ref(scope.table)}
      order by ${sql.ref(scope.group)}, position, ${sql.ref(scope.tiebreak)}
    `.execute(db);

    const seen = new Map<string, string[]>();
    for (const row of rows) {
      if (row.sort_key === null) {
        throw new Error(`${label}: ${scope.table} row in scope ${row.group} has no sort_key`);
      }
      expect(isValidSortKey(row.sort_key)).toBe(true);
      const bucket = seen.get(row.group);
      if (bucket) bucket.push(row.sort_key);
      else seen.set(row.group, [row.sort_key]);
    }

    for (const [group, keys] of seen) {
      const sorted = [...keys].sort();
      if (JSON.stringify(keys) !== JSON.stringify(sorted)) {
        throw new Error(
          `${label}: ${scope.table} scope ${group} orders by position as ${keys.join(',')} ` +
            `but by key as ${sorted.join(',')}`
        );
      }
      expect(new Set(keys).size).toBe(keys.length);
    }
  }
}

describe('sort_key derivation', () => {
  const ctx = new TestContext();
  let owner: TestUser;
  let projectId: string;
  let columnId: string;
  let otherColumnId: string;

  async function createTask(position: number, id = newId()): Promise<string> {
    const res = await ctx.request(owner.token).post('/api/tasks', {
      id,
      project_id: projectId,
      column_id: columnId,
      title: `card ${position}`,
      position,
    });
    expect(res.status).toBe(201);
    return id;
  }

  beforeAll(async () => {
    owner = await ctx.createUser('sortkey');
    projectId = newId();
    const project = await ctx
      .request(owner.token)
      .post('/api/projects', { id: projectId, name: 'Sort keys' });
    expect(project.status).toBe(201);

    const payload = await ctx.request(owner.token).get(`/api/projects/${projectId}`);
    expect(payload.status).toBe(200);
    const board = (await payload.json()) as { columns: { id: string }[] };
    columnId = board.columns[0]!.id;
    otherColumnId = board.columns[1]!.id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('gives a default project board keys straight away', async () => {
    await assertKeysMatchPositions('after project create');
  });

  it('keeps keys aligned as cards are created and moved', async () => {
    const first = await createTask(1000);
    const second = await createTask(2000);
    await assertKeysMatchPositions('after creates');

    const middle = await createTask(1500);
    await assertKeysMatchPositions('after insert between');

    // Drag to the top: the cheap greedy reconciler would rewrite the column here.
    const toTop = await ctx.request(owner.token).patch(`/api/tasks/${second}`, { position: 100 });
    expect(toTop.status).toBe(200);
    await assertKeysMatchPositions('after drag to top');

    const across = await ctx
      .request(owner.token)
      .patch(`/api/tasks/${first}`, { column_id: otherColumnId, position: 500 });
    expect(across.status).toBe(200);
    await assertKeysMatchPositions('after move across columns');

    expect(middle).toBeTruthy();
  });

  it('keeps keys aligned through a one-shot reorder', async () => {
    const ids = [await createTask(10_000), await createTask(20_000), await createTask(30_000)];
    const reorder = await ctx
      .request(owner.token)
      .post(`/api/columns/${columnId}/reorder`, { task_ids: [...ids].reverse() });
    expect(reorder.status).toBe(200);
    await assertKeysMatchPositions('after reorder');
  });

  it('keeps keys aligned for batch create, checklists and duplication', async () => {
    const batch = await ctx.request(owner.token).post('/api/tasks/batch', {
      project_id: projectId,
      column_id: columnId,
      tasks: [
        { id: newId(), title: 'a', position: 50_000 },
        { id: newId(), title: 'b', position: 60_000 },
      ],
    });
    expect(batch.status).toBe(201);
    await assertKeysMatchPositions('after batch create');

    const taskId = await createTask(70_000);
    for (const position of [3000, 1000, 2000]) {
      const item = await ctx.request(owner.token).post('/api/checklist-items', {
        id: newId(),
        task_id: taskId,
        text: `item ${position}`,
        position,
      });
      expect(item.status).toBe(201);
    }
    await assertKeysMatchPositions('after checklist items');

    const duplicate = await ctx
      .request(owner.token)
      .post(`/api/tasks/${taskId}/duplicate`, { id: newId(), position: 75_000 });
    expect(duplicate.status).toBe(201);
    await assertKeysMatchPositions('after duplicate');
  });

  it('keeps keys aligned when columns and project order change', async () => {
    const column = await ctx.request(owner.token).post('/api/columns', {
      id: newId(),
      project_id: projectId,
      name: 'Extra',
      position: 500,
    });
    expect(column.status).toBe(201);
    await assertKeysMatchPositions('after column create');

    const position = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/position`, { position: 2500 });
    expect(position.status).toBe(204);
    await assertKeysMatchPositions('after project position');
  });
});
