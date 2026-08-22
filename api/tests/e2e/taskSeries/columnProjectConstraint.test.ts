import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { ProjectFixtures } from '../tasks/taskFixtures';

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

describe('Cross-project (project_id, column_id) pairs on task_series, written straight to the database', () => {
  const fixtures = new ProjectFixtures();
  let project: string;
  let ownColumn: string;
  let foreignColumn: string;

  beforeAll(async () => {
    project = await fixtures.createProject('series column constraint');
    const otherProject = await fixtures.createProject('series column constraint other');
    ownColumn = await fixtures.createColumn(project);
    foreignColumn = await fixtures.createColumn(otherProject);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  async function insertSeriesInto(columnId: string | null): Promise<string> {
    const id = newId();
    await db
      .insertInto('task_series')
      .values({
        id,
        project_id: project,
        column_id: columnId,
        title: 'written past the routes',
        rrule: 'FREQ=DAILY',
        start_date: '2026-01-01',
        timezone: 'UTC',
      })
      .execute();
    return id;
  }

  // The control row: the rejections below differ from it in the column id only.
  it('accepts the row when the column is the project’s own', async () => {
    await expect(insertSeriesInto(ownColumn)).resolves.toBeDefined();
  });

  // MATCH SIMPLE skips the check entirely once one of the pair is null, which is
  // what leaves a series with no destination alone.
  it('accepts the row when the series has no column', async () => {
    await expect(insertSeriesInto(null)).resolves.toBeDefined();
  });

  it('refuses an insert naming another project’s column', async () => {
    const err = await rejectionOf(() => insertSeriesInto(foreignColumn));
    expect(err.code).toBe('23503');
    expect(err.constraint).toBe('task_series_project_id_column_id_fkey');
    expect(err.detail).toContain(`(project_id, column_id)=(${project}, ${foreignColumn})`);
  });

  it('refuses an update moving a series onto another project’s column', async () => {
    const seriesId = await insertSeriesInto(ownColumn);
    const err = await rejectionOf(() =>
      db
        .updateTable('task_series')
        .set({ column_id: foreignColumn })
        .where('id', '=', seriesId)
        .execute()
    );
    expect(err.code).toBe('23503');
    expect(err.constraint).toBe('task_series_project_id_column_id_fkey');
  });

  // The composite key has to reject what the column_id-only key used to.
  it('refuses an insert naming a column that does not exist', async () => {
    const err = await rejectionOf(() => insertSeriesInto(newId()));
    expect(err.code).toBe('23503');
    expect(err.constraint).toBe('task_series_project_id_column_id_fkey');
  });

  // The column list on SET NULL is what keeps this from trying to null the
  // NOT NULL project_id alongside it.
  it('clears only column_id when the column is deleted, leaving the schedule intact', async () => {
    const column = await fixtures.createColumn(project);
    const seriesId = await insertSeriesInto(column);

    await db.deleteFrom('board_column').where('id', '=', column).execute();

    const survivor = await db
      .selectFrom('task_series')
      .select(['id', 'project_id', 'column_id'])
      .where('id', '=', seriesId)
      .executeTakeFirst();
    expect(survivor).toMatchObject({ id: seriesId, project_id: project, column_id: null });
  });
});
