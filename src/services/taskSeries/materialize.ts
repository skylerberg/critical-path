import { sql } from 'kysely';
import { db } from '../../db/index';
import type { BoardTask, TaskSeriesResponse } from '../../schemas/index';
import { logger } from '../../utils/logger';
import { projectAccessIdsAmong } from '../authorization';
import { lockColumnTail } from '../boardColumns';
import { fetchBoardTaskRows } from '../boardPayload';
import { PROJECT_CHANGED, publish } from '../realtime/bus';
import { reconcileSortKeys } from '../sortKeyAssignment';
import { recordTaskActivity } from '../taskActivity';
import { enqueueDeliveries } from '../webhooks/queue';
import type { WebhookEvent } from '../webhooks/events';
import { SERIES_UPDATED } from './events';
import { fetchSeries } from './read';
import { firstOccurrenceOnOrAfter, nextOccurrenceAfter, occurrencesBetween } from './rule';
import { occurrenceInstant } from './write';

export const TASK_SERIES_JOB_KIND = 'task_series_materialize';
export const SWEEP_INTERVAL_SECONDS = 60;
export const SWEEP_TIMEOUT_MS = 15_000;
export const SWEEP_BATCH = 25;
export const SWEEP_BUDGET_MS = 10_000;
export const MAX_CATCHUP_SCAN = 500;
export const MAX_CONSECUTIVE_FAILURES = 5;

const POSITION_GAP = 1000;
const CHECKLIST_INSERT_CHUNK = 5000;
const MAX_ERROR_CHARS = 2000;

interface MaterializeResult {
  projectId: string;
  actorUserId: string | null;
  boardTasks: BoardTask[];
  series: TaskSeriesResponse | null;
}

interface Candidate {
  id: string;
  next_occurrence_at: Date;
}

async function claimCandidates(
  cursorAt: Date | null,
  cursorId: string | null,
  limit: number
): Promise<Candidate[]> {
  // Keyset rather than OFFSET or a bare LIMIT: a series another replica holds
  // stays at the head of the result set, and an offsetless re-query would spin
  // on it forever.
  const { rows } = await sql<Candidate>`
    select s.id, s.next_occurrence_at
    from task_series s
    join project p on p.id = s.project_id
    where s.status = 'active'
      and s.column_id is not null
      and s.next_occurrence_at is not null
      and s.next_occurrence_at <= now()
      and p.archived_at is null
      and (
        ${cursorAt}::timestamptz is null
        or (s.next_occurrence_at, s.id) > (${cursorAt}::timestamptz, ${cursorId}::uuid)
      )
    order by s.next_occurrence_at, s.id
    limit ${limit}
  `.execute(db);
  return rows;
}

export async function runSeriesSweep(opts: { budgetMs?: number } = {}): Promise<number> {
  const deadline = Date.now() + (opts.budgetMs ?? SWEEP_BUDGET_MS);
  const webhookEvents: WebhookEvent[] = [];
  let cursorAt: Date | null = null;
  let cursorId: string | null = null;
  let processed = 0;

  while (processed < SWEEP_BATCH && Date.now() < deadline) {
    const candidates = await claimCandidates(cursorAt, cursorId, SWEEP_BATCH - processed);
    if (candidates.length === 0) break;

    for (const candidate of candidates) {
      cursorAt = candidate.next_occurrence_at;
      cursorId = candidate.id;
      processed += 1;

      let result: MaterializeResult | null = null;
      try {
        result = await materializeSeries(candidate.id);
      } catch (err) {
        await recordSeriesFailure(candidate.id, err);
      }
      if (result !== null) {
        announce(result, webhookEvents);
      }
      if (Date.now() >= deadline) break;
    }
  }

  if (processed === SWEEP_BATCH) {
    logger.warn({ msg: 'Recurring series sweep filled its batch', count: processed });
  }

  if (webhookEvents.length > 0) {
    try {
      await enqueueDeliveries(webhookEvents);
    } catch (err) {
      logger.error({
        msg: 'Recurring series webhook enqueue failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return processed;
}

// The transaction has already committed, so each publish is at most once and a
// failure here must not undo the cards.
function announce(result: MaterializeResult, webhookEvents: WebhookEvent[]): void {
  try {
    // Even a run that created nothing moved the schedule on, and an open panel
    // showing a next occurrence in the past is wrong rather than merely stale.
    if (result.series !== null) {
      publish({ type: SERIES_UPDATED, project_id: result.projectId, data: result.series });
    }
    if (result.boardTasks.length === 0) return;
    for (const boardTask of result.boardTasks) {
      publish({ type: 'task_created', project_id: result.projectId, data: boardTask });
      webhookEvents.push({
        type: 'task_created',
        project_id: result.projectId,
        data: boardTask,
      });
    }
    // The actor rides along so the unread dot agrees with the one a board read
    // computes from the activity log: with no actor there is no activity row
    // either, so naming nobody would raise a dot that vanishes on reload.
    publish({
      type: PROJECT_CHANGED,
      project_id: result.projectId,
      data: {
        id: result.projectId,
        ...(result.actorUserId === null ? {} : { actor_user_id: result.actorUserId }),
      },
      broadcast: true,
    });
  } catch (err) {
    logger.error({
      msg: 'Recurring series realtime publish failed',
      project_id: result.projectId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// A periodic job row is never retired on failure, so a handler that throws would
// stall every project's schedules behind its backoff.
async function recordSeriesFailure(seriesId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ msg: 'Recurring series could not be materialised', series_id: seriesId, message });
  try {
    await db
      .updateTable('task_series')
      .set((eb) => ({
        consecutive_failures: eb('consecutive_failures', '+', 1),
        last_error: message.slice(0, MAX_ERROR_CHARS),
        updated_at: sql<Date>`now()`,
      }))
      .where('id', '=', seriesId)
      .execute();
    await db
      .updateTable('task_series')
      .set({ status: 'paused', next_occurrence_at: null })
      .where('id', '=', seriesId)
      .where('consecutive_failures', '>=', MAX_CONSECUTIVE_FAILURES)
      .execute();
    const [row] = await fetchSeries(db, { ids: [seriesId] });
    if (row) {
      publish({ type: SERIES_UPDATED, project_id: row.project_id, data: row });
    }
  } catch (recordErr) {
    logger.error({
      msg: 'Recurring series failure could not be recorded',
      series_id: seriesId,
      error: recordErr instanceof Error ? recordErr.message : String(recordErr),
    });
  }
}

export async function materializeSeries(seriesId: string): Promise<MaterializeResult | null> {
  return db.transaction().execute(async (trx) => {
    // The job lease covers the job row, and one row drives every series, so it
    // offers no per-series exclusion at all; this is what does.
    const series = await trx
      .selectFrom('task_series')
      .selectAll('task_series')
      .select([
        sql<string>`to_char(task_series.start_date, 'YYYY-MM-DD')`.as('start_date_text'),
        sql<string | null>`to_char(task_series.next_occurrence_date, 'YYYY-MM-DD')`.as('next_text'),
        sql<string | null>`to_char(task_series.due_date, 'YYYY-MM-DD')`.as('due_date_text'),
        sql<string>`to_char((now() at time zone task_series.timezone)::date, 'YYYY-MM-DD')`.as(
          'today_text'
        ),
      ])
      .where('task_series.id', '=', seriesId)
      .where('task_series.status', '=', 'active')
      .where('task_series.column_id', 'is not', null)
      .where('task_series.next_occurrence_at', '<=', sql<Date>`now()`)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!series || series.column_id === null) {
      return null;
    }

    const project = await trx
      .selectFrom('project')
      .select(['project.id', 'project.created_by', 'project.archived_at'])
      .where('project.id', '=', series.project_id)
      .executeTakeFirst();
    if (!project || project.archived_at !== null) {
      return null;
    }

    const today = series.today_text;
    const from = series.next_text ?? today;
    const window = occurrencesBetween(
      series.rrule,
      series.start_date_text,
      from,
      today,
      MAX_CATCHUP_SCAN
    );

    let due: string[];
    let missedDates: string[];
    let next: string | null;
    if (window.length === 0) {
      // Only reachable if next_occurrence_date drifted off the rule.
      due = [];
      missedDates = [];
      next = firstOccurrenceOnOrAfter(series.rrule, series.start_date_text, today);
    } else if (window.length === MAX_CATCHUP_SCAN && window[window.length - 1] < today) {
      // The scan saturated, so this run only walks the backlog forward; the
      // series stays due and converges over the next few sweeps. A full window
      // ending today is not saturation — nothing can follow today inside it —
      // and counting it as one would drop today's card.
      due = [];
      missedDates = window;
      next = nextOccurrenceAfter(series.rrule, series.start_date_text, window[window.length - 1]);
    } else {
      // Everything strictly before today is counted and never created: a week of
      // stale cards is the worse failure.
      due = window.filter((date) => date >= today);
      missedDates = window.filter((date) => date < today);
      next = nextOccurrenceAfter(series.rrule, series.start_date_text, window[window.length - 1]);
    }

    // A series outlives the account that set it up.
    const actorUserId = series.created_by ?? project.created_by;
    const createdIds = await createOccurrences(trx, series, project, actorUserId, due);

    await trx
      .updateTable('task_series')
      .set({
        next_occurrence_date: next,
        next_occurrence_at: next === null ? null : occurrenceInstant(next, series.timezone),
        status: next === null ? 'ended' : 'active',
        ended_at: next === null ? sql<Date>`now()` : null,
        ...(due.length > 0 ? { last_occurrence_date: due[due.length - 1] } : {}),
        missed_occurrence_count: series.missed_occurrence_count + missedDates.length,
        ...(missedDates.length > 0
          ? { last_missed_date: missedDates[missedDates.length - 1] }
          : {}),
        consecutive_failures: 0,
        last_error: null,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', series.id)
      .execute();

    const rows = await fetchBoardTaskRows(trx, createdIds);
    const [advanced] = await fetchSeries(trx, { ids: [series.id] });
    return {
      projectId: series.project_id,
      actorUserId,
      boardTasks: rows.map((row) => row.task),
      series: advanced ?? null,
    };
  });
}

type Trx = Parameters<Parameters<ReturnType<typeof db.transaction>['execute']>[0]>[0];

async function createOccurrences(
  trx: Trx,
  series: {
    id: string;
    project_id: string;
    column_id: string | null;
    title: string;
    description: unknown;
    due_date_text: string | null;
  },
  project: { id: string; created_by: string | null },
  actorUserId: string | null,
  due: string[]
): Promise<string[]> {
  if (due.length === 0 || series.column_id === null) {
    return [];
  }
  const columnId = series.column_id;

  const labelRows = await trx
    .selectFrom('task_series_label')
    .innerJoin('label', 'label.id', 'task_series_label.label_id')
    .select('task_series_label.label_id')
    .where('task_series_label.series_id', '=', series.id)
    .where('label.project_id', '=', series.project_id)
    .execute();

  const assigneeRows = await trx
    .selectFrom('task_series_assignee')
    .select('task_series_assignee.user_id')
    .where('task_series_assignee.series_id', '=', series.id)
    .execute();
  // A member can lose project access between the series being written and the
  // occurrence falling due, and no foreign key models that.
  const assigneeIds = await projectAccessIdsAmong(
    trx,
    project,
    assigneeRows.map((row) => row.user_id)
  );

  const checklistRows = await trx
    .selectFrom('task_series_checklist_item')
    .select(['task_series_checklist_item.id', 'task_series_checklist_item.text'])
    .where('task_series_checklist_item.series_id', '=', series.id)
    .orderBy('task_series_checklist_item.sort_key')
    .orderBy('task_series_checklist_item.id')
    .execute();

  // The sweep runs on every replica, and a user moving cards into this column
  // concurrently would otherwise share the tail this probe reads.
  await lockColumnTail(trx, columnId);

  const tail = await trx
    .selectFrom('task')
    .select((eb) => eb.fn.max('task.position').as('max_position'))
    .where('task.column_id', '=', columnId)
    .executeTakeFirst();
  let position = Number(tail?.max_position ?? 0);

  const description = series.description === null ? null : JSON.stringify(series.description);
  const createdIds: string[] = [];

  for (const occurrence of due) {
    position += POSITION_GAP;
    // do-nothing rather than a caught 23505: a raised unique violation aborts
    // the transaction, and the schedule advance below still has to run.
    const inserted = await trx
      .insertInto('task')
      .values({
        id: crypto.randomUUID(),
        project_id: series.project_id,
        column_id: columnId,
        title: series.title,
        description,
        position,
        due_date: series.due_date_text,
        series_id: series.id,
        series_occurrence_date: occurrence,
      })
      .onConflict((oc) =>
        oc
          .columns(['series_id', 'series_occurrence_date'])
          .where('series_id', 'is not', null)
          .doNothing()
      )
      .returning('id')
      .executeTakeFirst();
    if (!inserted) continue;

    const taskId = inserted.id;
    createdIds.push(taskId);

    if (labelRows.length > 0) {
      await trx
        .insertInto('task_label')
        .values(labelRows.map((row) => ({ task_id: taskId, label_id: row.label_id })))
        .execute();
    }
    if (assigneeIds.length > 0) {
      await trx
        .insertInto('task_assignee')
        .values(assigneeIds.map((user_id) => ({ task_id: taskId, user_id })))
        .execute();
    }
    for (let start = 0; start < checklistRows.length; start += CHECKLIST_INSERT_CHUNK) {
      await trx
        .insertInto('checklist_item')
        .values(
          checklistRows.slice(start, start + CHECKLIST_INSERT_CHUNK).map((row, index) => ({
            id: crypto.randomUUID(),
            task_id: taskId,
            text: row.text,
            position: (start + index + 1) * POSITION_GAP,
          }))
        )
        .execute();
    }
    if (checklistRows.length > 0) {
      await reconcileSortKeys(trx, 'checklist_item', taskId);
    }

    // An activity row needs a real person and there is no system user, so an
    // ownerless project gets a card with no history rather than no card.
    if (actorUserId !== null) {
      await recordTaskActivity(trx, actorUserId, [
        { taskId, kind: 'created', newValue: { text: series.title } },
      ]);
    }
  }

  if (createdIds.length > 0) {
    await reconcileSortKeys(trx, 'task', columnId);
  }

  return createdIds;
}
