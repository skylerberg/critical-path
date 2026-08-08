import type { Kysely } from 'kysely';
import type { DB } from '../../db/types';
import type { TaskSeriesResponse } from '../../schemas/index';
import { publishAfterCommit } from '../realtime/bus';
import { fetchSeries } from './read';

const SERIES_CREATED = 'series_created';
export const SERIES_UPDATED = 'series_updated';
const SERIES_DELETED = 'series_deleted';

type PublishContext = Parameters<typeof publishAfterCommit>[0];

export function publishSeriesCreated(c: PublishContext, series: TaskSeriesResponse): void {
  publishAfterCommit(c, SERIES_CREATED, series.project_id, series);
}

export function publishSeriesUpdated(c: PublishContext, series: TaskSeriesResponse): void {
  publishAfterCommit(c, SERIES_UPDATED, series.project_id, series);
}

export function publishSeriesDeleted(c: PublishContext, projectId: string, id: string): void {
  publishAfterCommit(c, SERIES_DELETED, projectId, { id });
}

// For rows a cascade moved rather than a call that already read them back.
export async function publishSeriesUpdatedByIds(
  c: PublishContext,
  db: Kysely<DB>,
  ids: readonly string[]
): Promise<void> {
  for (const series of await fetchSeries(db, { ids })) {
    publishSeriesUpdated(c, series);
  }
}
