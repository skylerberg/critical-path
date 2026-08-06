import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../helpers/database';
import { newId, rankKey } from '../../helpers/fixtures';
import { ProjectFixtures } from './taskFixtures';

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
}

async function rejectionOf(write: () => Promise<unknown>): Promise<PgError> {
  try {
    await write();
  } catch (err) {
    return err as PgError;
  }
  throw new Error('the database accepted a write it should have refused');
}

describe('Cross-project (project_id, column_id) pairs, written straight to the database', () => {
  const fixtures = new ProjectFixtures();
  let project: string;
  let ownColumn: string;
  let foreignColumn: string;

  beforeAll(async () => {
    project = await fixtures.createProject('column constraint');
    const otherProject = await fixtures.createProject('column constraint other');
    ownColumn = await fixtures.createColumn(project);
    foreignColumn = await fixtures.createColumn(otherProject);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  function insertTaskInto(columnId: string): Promise<unknown> {
    return db
      .insertInto('task')
      .values({
        id: newId(),
        project_id: project,
        column_id: columnId,
        title: 'written past the routes',
        sort_key: rankKey(1000),
      })
      .execute();
  }

  // The rejections below differ from this row in the column id and nothing else,
  // so none of them can be blamed on some other constraint.
  it('accepts the row when the column is the project’s own', async () => {
    await expect(insertTaskInto(ownColumn)).resolves.toBeDefined();
  });

  it('refuses an insert naming another project’s column', async () => {
    const err = await rejectionOf(() => insertTaskInto(foreignColumn));
    expect(err.code).toBe('23503');
    expect(err.constraint).toBe('task_project_id_column_id_fkey');
    expect(err.detail).toContain(`(project_id, column_id)=(${project}, ${foreignColumn})`);
  });

  it('refuses an update moving a task onto another project’s column', async () => {
    const taskId = await fixtures.createTaskRow(project, ownColumn);
    const err = await rejectionOf(() =>
      db.updateTable('task').set({ column_id: foreignColumn }).where('id', '=', taskId).execute()
    );
    expect(err.code).toBe('23503');
    expect(err.constraint).toBe('task_project_id_column_id_fkey');
  });

  // The composite key is the only one left, so it has to reject what the
  // column_id-only key used to.
  it('refuses an insert naming a column that does not exist', async () => {
    const err = await rejectionOf(() => insertTaskInto(newId()));
    expect(err.code).toBe('23503');
    expect(err.constraint).toBe('task_project_id_column_id_fkey');
  });

  it('still deletes a column’s tasks with the column', async () => {
    const column = await fixtures.createColumn(project);
    const taskId = await fixtures.createTaskRow(project, column);

    await db.deleteFrom('board_column').where('id', '=', column).execute();

    const survivor = await db
      .selectFrom('task')
      .select('id')
      .where('id', '=', taskId)
      .executeTakeFirst();
    expect(survivor).toBeUndefined();
  });
});
