import type { Kysely, Selectable } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB, TaskSeries } from '../../db/types';
import type { TaskSeriesRef, TaskSeriesResponse, TiptapDoc } from '../../schemas/index';
import { dateText } from '../dateText';
import { presetFor, summarize } from './rule';

// Fail closed: the column is plain text, so a value a newer release wrote — or
// one nothing writes — reads as the state the materializer's `status = 'active'`
// claim already puts it in, rather than as a schedule a client thinks is live.
function narrowSeriesStatus(status: string): TaskSeriesResponse['status'] {
  return status === 'active' || status === 'paused' ? status : 'ended';
}

export interface FetchSeriesFilter {
  projectId?: string;
  ids?: readonly string[];
}

export async function fetchSeries(
  db: Kysely<DB>,
  filter: FetchSeriesFilter
): Promise<TaskSeriesResponse[]> {
  if (filter.ids !== undefined && filter.ids.length === 0) {
    return [];
  }
  let query = db
    .selectFrom('task_series')
    .select((eb) => [
      'task_series.id',
      'task_series.project_id',
      'task_series.column_id',
      'task_series.title',
      'task_series.description',
      dateText('task_series.due_date').as('due_date'),
      'task_series.rrule',
      dateText('task_series.start_date').as('start_date'),
      'task_series.timezone',
      'task_series.status',
      dateText('task_series.next_occurrence_date').as('next_occurrence_date'),
      dateText('task_series.last_occurrence_date').as('last_occurrence_date'),
      'task_series.missed_occurrence_count',
      dateText('task_series.last_missed_date').as('last_missed_date'),
      'task_series.last_error',
      'task_series.ended_at',
      'task_series.created_by',
      'task_series.created_at',
      'task_series.updated_at',
      jsonArrayFrom(
        eb
          .selectFrom('task_series_label')
          .select('task_series_label.label_id')
          .whereRef('task_series_label.series_id', '=', 'task_series.id')
          .orderBy('task_series_label.label_id')
      ).as('label_rows'),
      jsonArrayFrom(
        eb
          .selectFrom('task_series_assignee')
          .select('task_series_assignee.user_id')
          .whereRef('task_series_assignee.series_id', '=', 'task_series.id')
          .orderBy('task_series_assignee.user_id')
      ).as('assignee_rows'),
      jsonArrayFrom(
        eb
          .selectFrom('task_series_checklist_item')
          .select([
            'task_series_checklist_item.id',
            'task_series_checklist_item.text',
            'task_series_checklist_item.sort_key',
          ])
          .whereRef('task_series_checklist_item.series_id', '=', 'task_series.id')
          .orderBy('task_series_checklist_item.sort_key')
          .orderBy('task_series_checklist_item.id')
      ).as('checklist_rows'),
      // The honest half of "create the next occurrence anyway": the panel says
      // so when earlier ones are still outstanding.
      eb
        .selectFrom('task')
        .innerJoin('board_column', 'board_column.id', 'task.column_id')
        .select((cb) => cb.fn.countAll<string>().as('open_count'))
        .whereRef('task.series_id', '=', 'task_series.id')
        .where('task.archived_at', 'is', null)
        .where('board_column.is_done', '=', false)
        .as('open_occurrence_count'),
    ])
    .orderBy('task_series.next_occurrence_date', (ob) => ob.asc().nullsLast())
    .orderBy('task_series.created_at')
    .orderBy('task_series.id');

  if (filter.projectId !== undefined) {
    query = query.where('task_series.project_id', '=', filter.projectId);
  }
  if (filter.ids !== undefined) {
    query = query.where('task_series.id', 'in', [...filter.ids]);
  }

  const rows = await query.execute();

  return rows.map((row) => ({
    id: row.id,
    project_id: row.project_id,
    column_id: row.column_id,
    title: row.title,
    description: row.description as TiptapDoc | null,
    due_date: row.due_date,
    rrule: row.rrule,
    preset: presetFor(row.rrule, row.start_date as string),
    summary: summarize(row.rrule, row.start_date as string),
    start_date: row.start_date as string,
    timezone: row.timezone,
    status: narrowSeriesStatus(row.status),
    next_occurrence_date: row.next_occurrence_date,
    last_occurrence_date: row.last_occurrence_date,
    missed_occurrence_count: row.missed_occurrence_count,
    last_missed_date: row.last_missed_date,
    open_occurrence_count: Number(row.open_occurrence_count),
    last_error: row.last_error,
    ended_at: row.ended_at?.toISOString() ?? null,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    label_ids: row.label_rows.map((label) => label.label_id),
    assignee_ids: row.assignee_rows.map((assignee) => assignee.user_id),
    checklist_items: row.checklist_rows,
  }));
}

// Card detail only. Every board payload carrying this would mean a join and a
// rule render per card, for a line one open card at a time ever shows.
//
// The preset and the anchor ride along with the summary because the card's own
// recurrence menu is built from them, and they cost nothing extra here: both are
// pure functions of the rrule and start_date this row already selects. Without
// them the card has to fetch the whole project's series list to preselect one
// dropdown.
export async function seriesRefForTask(
  db: Kysely<DB>,
  taskId: string
): Promise<TaskSeriesRef | null> {
  const row = await db
    .selectFrom('task')
    .innerJoin('task_series', 'task_series.id', 'task.series_id')
    .select([
      'task_series.id',
      'task_series.rrule',
      dateText('task_series.start_date').as('start_date'),
    ])
    .where('task.id', '=', taskId)
    .executeTakeFirst();
  if (!row) {
    return null;
  }
  const startDate = row.start_date as string;
  return {
    id: row.id,
    summary: summarize(row.rrule, startDate),
    preset: presetFor(row.rrule, startDate),
    start_date: startDate,
  };
}

export type SeriesRow = Selectable<TaskSeries> & { start_date_text: string };
