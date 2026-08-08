import type { Kysely, Selectable } from 'kysely';
import type { DB, Project } from '../../db/types';
import { AppError } from '../../utils/errors';
import { assertProjectWrite } from '../authorization';
import { dateText } from '../dateText';
import type { SeriesRow } from './read';

const SERIES_NOT_FOUND = 'Series not found';

async function loadSeriesRow(db: Kysely<DB>, seriesId: string): Promise<SeriesRow> {
  const series = await db
    .selectFrom('task_series')
    .selectAll()
    .select(dateText('task_series.start_date').as('start_date_text'))
    .where('task_series.id', '=', seriesId)
    .executeTakeFirst();
  if (!series) {
    throw new AppError(404, SERIES_NOT_FOUND);
  }
  return { ...series, start_date_text: series.start_date_text as string };
}

// 404 for a caller with no access to the series' project, so an inaccessible
// series stays indistinguishable from a nonexistent one; 403 for a viewer.
export async function assertSeriesWrite(
  db: Kysely<DB>,
  userId: string,
  seriesId: string
): Promise<{ series: SeriesRow; project: Selectable<Project> }> {
  const series = await loadSeriesRow(db, seriesId);
  const project = await assertProjectWrite(db, userId, series.project_id, SERIES_NOT_FOUND);
  return { series, project };
}
