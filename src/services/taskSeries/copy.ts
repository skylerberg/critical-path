import { sql, type Kysely } from 'kysely';
import type { DB } from '../../db/types';
import { projectAccessIdsAmong, type ProjectAccessFields } from '../authorization';
import { scheduleFrom, todayIn } from './write';

export interface CopySeriesInput {
  sourceProjectId: string;
  project: ProjectAccessFields;
  createdBy: string;
  columnIdFor: (sourceColumnId: string) => string;
  labelIdFor: (sourceLabelId: string) => string;
}

export async function copySeries(db: Kysely<DB>, input: CopySeriesInput): Promise<void> {
  const sources = await db
    .selectFrom('task_series')
    .selectAll('task_series')
    .select(sql<string>`to_char(task_series.start_date, 'YYYY-MM-DD')`.as('start_date_text'))
    .select(sql<string | null>`to_char(task_series.due_date, 'YYYY-MM-DD')`.as('due_date_text'))
    .where('task_series.project_id', '=', input.sourceProjectId)
    .execute();
  if (sources.length === 0) return;

  const seriesIdMap = new Map(sources.map((series) => [series.id, crypto.randomUUID()]));
  const todayByZone = new Map<string, string>();
  for (const zone of new Set(sources.map((series) => series.timezone))) {
    todayByZone.set(zone, await todayIn(db, zone));
  }

  for (const series of sources) {
    // Carrying the source's next occurrence over verbatim would fire a stale one
    // the moment the copy lands, so the schedule is recomputed from today.
    const schedule = scheduleFrom(
      {
        rrule: series.rrule,
        startDate: series.start_date_text,
        timezone: series.timezone,
      },
      todayByZone.get(series.timezone) as string
    );
    const exhausted = schedule.next_occurrence_date === null;

    await db
      .insertInto('task_series')
      .values({
        id: seriesIdMap.get(series.id) as string,
        project_id: input.project.id,
        column_id: series.column_id === null ? null : input.columnIdFor(series.column_id),
        created_by: input.createdBy,
        title: series.title,
        description: series.description === null ? null : JSON.stringify(series.description),
        due_date: series.due_date_text,
        rrule: series.rrule,
        start_date: series.start_date_text,
        timezone: series.timezone,
        status: exhausted ? 'ended' : series.status,
        ended_at: exhausted ? sql<Date>`now()` : null,
        next_occurrence_date: schedule.next_occurrence_date,
        // A paused copy keeps the day it would land on but stays unclaimable.
        next_occurrence_at: series.status === 'paused' ? null : schedule.next_occurrence_at,
      })
      .execute();
  }

  const sourceIds = sources.map((series) => series.id);

  const labels = await db
    .selectFrom('task_series_label')
    .select(['task_series_label.series_id', 'task_series_label.label_id'])
    .where('task_series_label.series_id', 'in', sourceIds)
    .execute();
  if (labels.length > 0) {
    await db
      .insertInto('task_series_label')
      .values(
        labels.map((row) => ({
          series_id: seriesIdMap.get(row.series_id) as string,
          label_id: input.labelIdFor(row.label_id),
        }))
      )
      .execute();
  }

  const assignees = await db
    .selectFrom('task_series_assignee')
    .select(['task_series_assignee.series_id', 'task_series_assignee.user_id'])
    .where('task_series_assignee.series_id', 'in', sourceIds)
    .execute();
  const allowed = new Set(
    await projectAccessIdsAmong(db, input.project, [
      ...new Set(assignees.map((row) => row.user_id)),
    ])
  );
  const keptAssignees = assignees.filter((row) => allowed.has(row.user_id));
  if (keptAssignees.length > 0) {
    await db
      .insertInto('task_series_assignee')
      .values(
        keptAssignees.map((row) => ({
          series_id: seriesIdMap.get(row.series_id) as string,
          user_id: row.user_id,
        }))
      )
      .execute();
  }

  const checklistItems = await db
    .selectFrom('task_series_checklist_item')
    .select([
      'task_series_checklist_item.series_id',
      'task_series_checklist_item.text',
      'task_series_checklist_item.sort_key',
    ])
    .where('task_series_checklist_item.series_id', 'in', sourceIds)
    .execute();
  if (checklistItems.length > 0) {
    await db
      .insertInto('task_series_checklist_item')
      .values(
        checklistItems.map((row) => ({
          id: crypto.randomUUID(),
          series_id: seriesIdMap.get(row.series_id) as string,
          text: row.text,
          sort_key: row.sort_key,
        }))
      )
      .execute();
  }
}
