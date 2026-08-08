import { sql, type Kysely, type RawBuilder, type UpdateObject } from 'kysely';
import type { DB } from '../../db/types';
import type {
  CreateTaskSeriesInput,
  PatchTaskSeriesInput,
  TiptapDoc,
  TiptapNode,
} from '../../schemas/index';
import { AppError } from '../../utils/errors';
import { projectAccessIdsAmong, type ProjectAccessFields } from '../authorization';
import { assertColumnInProject } from '../boardColumns';
import { keysBetween } from '../sortKey';
import {
  assertUsableRrule,
  firstOccurrenceOnOrAfter,
  rruleForPreset,
  type RecurrencePreset,
} from './rule';
import type { SeriesRow } from './read';

export interface SeriesRuleFields {
  rrule: string;
  startDate: string;
  timezone: string;
}

interface StrippedDescription {
  description: TiptapDoc | null;
  droppedImageCount: number;
}

// A template owns no task, so an image node in it would point at a file owned by
// some other card and break the moment that card is deleted.
function stripImages(node: TiptapNode): { node: TiptapNode; dropped: number } {
  let dropped = 0;
  const next: TiptapNode = { ...node };
  if (next.content) {
    const kept: TiptapNode[] = [];
    for (const child of next.content) {
      if (child.type === 'image') {
        dropped += 1;
        continue;
      }
      const result = stripImages(child);
      dropped += result.dropped;
      kept.push(result.node);
    }
    next.content = kept;
  }
  return { node: next, dropped };
}

function stripDescriptionImages(description: TiptapDoc | null | undefined): StrippedDescription {
  if (description == null) {
    return { description: null, droppedImageCount: 0 };
  }
  const { node, dropped } = stripImages(description);
  return { description: node as TiptapDoc, droppedImageCount: dropped };
}

function serializeDescription(description: TiptapDoc | null): string | null {
  return description === null ? null : JSON.stringify(description);
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

async function assertLabelsInProject(
  db: Kysely<DB>,
  labelIds: string[],
  projectId: string
): Promise<void> {
  if (labelIds.length === 0) return;
  const rows = await db
    .selectFrom('label')
    .select('label.id')
    .where('label.id', 'in', labelIds)
    .where('label.project_id', '=', projectId)
    .execute();
  if (rows.length !== labelIds.length) {
    throw new AppError(422, 'label_ids must reference labels in the project');
  }
}

async function assertAssigneesHaveProjectAccess(
  db: Kysely<DB>,
  userIds: string[],
  project: ProjectAccessFields
): Promise<void> {
  const withAccess = await projectAccessIdsAmong(db, project, userIds);
  if (withAccess.length !== userIds.length) {
    throw new AppError(422, 'assignee_ids must reference users with access to the project');
  }
}

async function assertKnownTimezone(db: Kysely<DB>, timezone: string): Promise<void> {
  const row = await db
    .selectNoFrom(
      sql<boolean>`exists(select 1 from pg_timezone_names where name = ${timezone})`.as('known')
    )
    .executeTakeFirst();
  if (row?.known !== true) {
    throw new AppError(422, 'timezone must be an IANA time zone name');
  }
}

export async function todayIn(db: Kysely<DB>, timezone: string): Promise<string> {
  const row = await db
    .selectNoFrom(
      sql<string>`to_char((now() at time zone ${timezone})::date, 'YYYY-MM-DD')`.as('today')
    )
    .executeTakeFirstOrThrow();
  return row.today;
}

// Postgres owns the DST arithmetic, and the value is stored rather than derived
// per row in a WHERE clause, which is what keeps the sweep sargable.
export function occurrenceInstant(date: string, timezone: string): RawBuilder<Date> {
  return sql<Date>`(${date}::date::timestamp at time zone ${timezone})`;
}

function resolveRule(
  preset: RecurrencePreset | undefined,
  rrule: string | undefined,
  startDate: string
): string {
  if (preset !== undefined && rrule !== undefined) {
    throw new AppError(422, 'Send either preset or rrule, not both');
  }
  if (preset !== undefined) {
    return assertUsableRrule(rruleForPreset(preset, startDate), startDate);
  }
  if (rrule !== undefined) {
    return assertUsableRrule(rrule, startDate);
  }
  throw new AppError(422, 'Send either preset or rrule');
}

// The forward-only invariant: a schedule is only ever placed on or after today
// in its own zone, so a series anchored a year back backfills nothing and the
// unique index stays a pure concurrency backstop.
export function scheduleFrom(
  fields: SeriesRuleFields,
  today: string
): { next_occurrence_date: string | null; next_occurrence_at: RawBuilder<Date> | null } {
  const anchor = today > fields.startDate ? today : fields.startDate;
  const next = firstOccurrenceOnOrAfter(fields.rrule, fields.startDate, anchor);
  return {
    next_occurrence_date: next,
    next_occurrence_at: next === null ? null : occurrenceInstant(next, fields.timezone),
  };
}

interface ChildCollections {
  label_ids?: string[];
  assignee_ids?: string[];
  checklist_items?: { text: string }[];
}

async function writeChildren(
  db: Kysely<DB>,
  seriesId: string,
  projectId: string,
  project: ProjectAccessFields,
  body: ChildCollections,
  replace: boolean
): Promise<void> {
  if (body.label_ids !== undefined) {
    const labelIds = dedupe(body.label_ids);
    await assertLabelsInProject(db, labelIds, projectId);
    if (replace) {
      await db.deleteFrom('task_series_label').where('series_id', '=', seriesId).execute();
    }
    if (labelIds.length > 0) {
      await db
        .insertInto('task_series_label')
        .values(labelIds.map((label_id) => ({ series_id: seriesId, label_id })))
        .execute();
    }
  }

  if (body.assignee_ids !== undefined) {
    const assigneeIds = dedupe(body.assignee_ids);
    await assertAssigneesHaveProjectAccess(db, assigneeIds, project);
    if (replace) {
      await db.deleteFrom('task_series_assignee').where('series_id', '=', seriesId).execute();
    }
    if (assigneeIds.length > 0) {
      await db
        .insertInto('task_series_assignee')
        .values(assigneeIds.map((user_id) => ({ series_id: seriesId, user_id })))
        .execute();
    }
  }

  if (body.checklist_items !== undefined) {
    if (replace) {
      await db.deleteFrom('task_series_checklist_item').where('series_id', '=', seriesId).execute();
    }
    if (body.checklist_items.length > 0) {
      const templateKeys = keysBetween(null, null, body.checklist_items.length);
      await db
        .insertInto('task_series_checklist_item')
        .values(
          body.checklist_items.map((item, index) => ({
            id: crypto.randomUUID(),
            series_id: seriesId,
            text: item.text,
            sort_key: templateKeys[index]!,
          }))
        )
        .execute();
    }
  }
}

export async function createSeries(
  db: Kysely<DB>,
  userId: string,
  project: ProjectAccessFields,
  body: CreateTaskSeriesInput
): Promise<number> {
  await assertColumnInProject(db, body.column_id, body.project_id);
  await assertKnownTimezone(db, body.timezone);

  const rrule = resolveRule(body.preset, body.rrule, body.start_date);
  const { description, droppedImageCount } = stripDescriptionImages(body.description);
  const today = await todayIn(db, body.timezone);

  await db
    .insertInto('task_series')
    .values({
      id: body.id,
      project_id: body.project_id,
      column_id: body.column_id,
      created_by: userId,
      title: body.title,
      description: serializeDescription(description),
      due_date: body.due_date ?? null,
      rrule,
      start_date: body.start_date,
      timezone: body.timezone,
      ...scheduleFrom({ rrule, startDate: body.start_date, timezone: body.timezone }, today),
    })
    .execute();

  await writeChildren(
    db,
    body.id,
    body.project_id,
    project,
    {
      label_ids: body.label_ids,
      assignee_ids: body.assignee_ids,
      checklist_items: body.checklist_items,
    },
    false
  );

  return droppedImageCount;
}

export async function patchSeries(
  db: Kysely<DB>,
  series: SeriesRow,
  project: ProjectAccessFields,
  body: PatchTaskSeriesInput
): Promise<number> {
  const startDate = body.start_date ?? series.start_date_text;
  const timezone = body.timezone ?? series.timezone;

  if (body.timezone !== undefined) {
    await assertKnownTimezone(db, timezone);
  }
  if (body.column_id !== undefined) {
    await assertColumnInProject(db, body.column_id, series.project_id);
  }

  const rrule =
    body.preset !== undefined || body.rrule !== undefined
      ? resolveRule(body.preset, body.rrule, startDate)
      : body.start_date !== undefined
        ? assertUsableRrule(series.rrule, startDate)
        : series.rrule;

  const { description, droppedImageCount } = stripDescriptionImages(body.description);

  const updates: UpdateObject<DB, 'task_series'> = { updated_at: sql<Date>`now()` };
  if (body.column_id !== undefined) updates.column_id = body.column_id;
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = serializeDescription(description);
  if (body.due_date !== undefined) updates.due_date = body.due_date;
  if (body.timezone !== undefined) updates.timezone = timezone;
  if (body.start_date !== undefined) updates.start_date = startDate;
  if (rrule !== series.rrule) updates.rrule = rrule;
  if (body.clear_missed === true) {
    updates.missed_occurrence_count = 0;
    updates.last_missed_date = null;
  }
  if (body.status !== undefined) {
    updates.status = body.status;
    if (body.status === 'active') updates.ended_at = null;
  }

  const scheduleChanged =
    body.preset !== undefined ||
    body.rrule !== undefined ||
    body.start_date !== undefined ||
    body.timezone !== undefined ||
    (body.status === 'active' && series.status !== 'active');

  const status = body.status ?? series.status;
  if (body.status === 'paused') {
    updates.next_occurrence_at = null;
  } else if (scheduleChanged) {
    if (status === 'active') {
      const today = await todayIn(db, timezone);
      const schedule = scheduleFrom({ rrule, startDate, timezone }, today);
      Object.assign(updates, schedule);
      updates.consecutive_failures = 0;
      updates.last_error = null;
      // Resuming a rule with nothing left ahead of it ends the series here
      // rather than leaving an active row the sweep can never claim.
      if (schedule.next_occurrence_date === null) {
        updates.status = 'ended';
        updates.ended_at = sql<Date>`now()`;
      }
    } else {
      updates.next_occurrence_date = null;
      updates.next_occurrence_at = null;
    }
  }

  await db.updateTable('task_series').set(updates).where('id', '=', series.id).execute();

  await writeChildren(
    db,
    series.id,
    series.project_id,
    project,
    {
      label_ids: body.label_ids,
      assignee_ids: body.assignee_ids,
      checklist_items: body.checklist_items,
    },
    true
  );

  return droppedImageCount;
}
