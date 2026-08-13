import { sql, type ExpressionBuilder, type Kysely, type RawBuilder } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB } from '../db/types';
import type { MyTask, MyTaskLink, MyTaskPersonGroup, MyTasksResponse } from '../schemas/index';
import { accessibleProjectsFilter } from './authorization';

// Large enough that a person with a normal amount of work assigned never
// reaches it — the whole point is that most callers never learn there is a page
// at all. It is a ceiling on one response, not on what the caller may see:
// next_offset walks the rest.
export const MY_TASKS_PAGE_SIZE = 1000;

interface AssigneeRow {
  user_id: string;
}

interface MyTaskLinkRow {
  id: string;
  project_id: string;
  title: string;
  assignee_rows: AssigneeRow[];
}

export interface MyTaskRow {
  id: string;
  project_id: string;
  project_name: string;
  column_name: string;
  title: string;
  assignee_rows: AssigneeRow[];
  blocked_by_rows: MyTaskLinkRow[];
  blocking_rows: MyTaskLinkRow[];
  hidden_blocked_by_count: number;
  hidden_blocking_count: number;
}

const BUCKET_RANK: Record<MyTask['bucket'], number> = { blocking: 0, ready: 1, blocked: 2 };

function toLink(row: MyTaskLinkRow): MyTaskLink {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    assignee_ids: row.assignee_rows.map((assignee) => assignee.user_id),
  };
}

export function bucketAndOrder(rows: MyTaskRow[], userId: string): MyTask[] {
  const tasks = rows.map((row): MyTask => {
    const blocking = row.blocking_rows.map(toLink);
    const blockedBy = row.blocked_by_rows.map(toLink);
    // Only from links the caller may read: naming someone whose project they
    // cannot open would leak the person along with the work. The hidden
    // dependents are surfaced as a count instead, so a task that only holds up
    // invisible people stays out of the blocking bucket rather than pointing at
    // nobody.
    const waitingUserIds = [...new Set(blocking.flatMap((link) => link.assignee_ids))]
      .filter((id) => id !== userId)
      .sort();
    // A blocker counts whether or not it can be named — that is the whole point
    // of the bucket, and the alternative files unstartable work as ready.
    const blocked = blockedBy.length + row.hidden_blocked_by_count > 0;
    return {
      id: row.id,
      project_id: row.project_id,
      project_name: row.project_name,
      column_name: row.column_name,
      title: row.title,
      assignee_ids: row.assignee_rows.map((assignee) => assignee.user_id),
      bucket: blocked ? 'blocked' : waitingUserIds.length > 0 ? 'blocking' : 'ready',
      waiting_user_ids: waitingUserIds,
      blocking,
      blocked_by: blockedBy,
      hidden_blocked_by_count: row.hidden_blocked_by_count,
      hidden_blocking_count: row.hidden_blocking_count,
    };
  });

  return tasks.sort(
    (a, b) =>
      BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] ||
      b.waiting_user_ids.length - a.waiting_user_ids.length
  );
}

export function personGroups(
  links: MyTaskLink[],
  userId: string,
  options: { includeUnassigned: boolean }
): MyTaskPersonGroup[] {
  const byUser = new Map<string | null, Map<string, MyTaskLink>>();

  const add = (key: string | null, link: MyTaskLink): void => {
    let group = byUser.get(key);
    if (group === undefined) {
      group = new Map();
      byUser.set(key, group);
    }
    if (!group.has(link.id)) {
      group.set(link.id, link);
    }
  };

  for (const link of links) {
    const others = link.assignee_ids.filter((id) => id !== userId);
    if (others.length > 0) {
      for (const id of others) {
        add(id, link);
      }
    } else if (link.assignee_ids.length === 0 && options.includeUnassigned) {
      add(null, link);
    }
  }

  return [...byUser]
    .map(([user_id, group]) => ({ user_id, tasks: [...group.values()] }))
    .sort((a, b) => {
      if (a.user_id === null || b.user_id === null) {
        return a.user_id === b.user_id ? 0 : a.user_id === null ? 1 : -1;
      }
      return b.tasks.length - a.tasks.length || a.user_id.localeCompare(b.user_id);
    });
}

// The far end of an edge may now live in a project the caller has no relation
// to. Every list below is filtered on this so nothing unreadable is ever named,
// and what it filters out is reported as a bare count instead.
//
// Deliberately counted over OPEN edges only, matching the visible lists:
// counting the done ones too would let a caller subtract the two and learn that
// a task they cannot see has been finished.
const inReadableProject = (userId: string) => sql<boolean>`
  exists (
    select 1 from project p
    where p.id = far.project_id
      and (
        p.created_by = ${userId}::uuid
        or exists (
          select 1 from project_member pm
          where pm.project_id = p.id and pm.user_id = ${userId}::uuid
        )
      )
  )
`;

function hiddenEdgeCount(userId: string, direction: 'blocked_by' | 'blocking'): RawBuilder<number> {
  const [near, far] =
    direction === 'blocked_by'
      ? [sql.raw('blocked_task_id'), sql.raw('blocker_task_id')]
      : [sql.raw('blocker_task_id'), sql.raw('blocked_task_id')];
  return sql<number>`(
    select count(*)::int
    from task_dependency d
    join task far on far.id = d.${far}
    join board_column far_column on far_column.id = far.column_id
    where d.${near} = task.id
      and far_column.is_done = false
      and far.archived_at is null
      and not ${inReadableProject(userId)}
  )`;
}

type MyTasksEb = ExpressionBuilder<DB, 'project' | 'task' | 'board_column'>;

// One definition of an edge worth showing, per direction: open at the far end,
// unarchived, and in a project the caller may read. The visible list and the
// number the ordering ranks by are both built from it, so the rank cannot come
// to disagree with the list it ranks — which is what would silently put a card
// on the wrong page.
//
// The two directions are spelled out rather than parameterised because the
// alias is part of the table expression, and a computed one collapses Kysely's
// inference to an uncallable union.
function openBlockers(eb: MyTasksEb, userId: string) {
  return eb
    .selectFrom('task_dependency')
    .innerJoin('task as blocker', 'blocker.id', 'task_dependency.blocker_task_id')
    .innerJoin('board_column as blocker_column', 'blocker_column.id', 'blocker.column_id')
    .whereRef('task_dependency.blocked_task_id', '=', 'task.id')
    .where('blocker_column.is_done', '=', false)
    .where('blocker.archived_at', 'is', null)
    .where((ib) =>
      ib.exists(
        ib
          .selectFrom('project')
          .select('project.id')
          .whereRef('project.id', '=', 'blocker.project_id')
          .where(accessibleProjectsFilter(userId))
      )
    );
}

function openDependents(eb: MyTasksEb, userId: string) {
  return eb
    .selectFrom('task_dependency')
    .innerJoin('task as dependent', 'dependent.id', 'task_dependency.blocked_task_id')
    .innerJoin('board_column as dependent_column', 'dependent_column.id', 'dependent.column_id')
    .whereRef('task_dependency.blocker_task_id', '=', 'task.id')
    .where('dependent_column.is_done', '=', false)
    .where('dependent.archived_at', 'is', null)
    .where((ib) =>
      ib.exists(
        ib
          .selectFrom('project')
          .select('project.id')
          .whereRef('project.id', '=', 'dependent.project_id')
          .where(accessibleProjectsFilter(userId))
      )
    );
}

function myTasksRows(db: Kysely<DB>, userId: string) {
  return db
    .selectFrom('project')
    .innerJoin('task', 'task.project_id', 'project.id')
    .innerJoin('board_column', 'board_column.id', 'task.column_id')
    .select((eb) => [
      'task.id',
      'task.project_id',
      'project.name as project_name',
      'board_column.name as column_name',
      'task.title',
      // Carried only to break ties in the outer ordering; not part of the
      // response, and dropped by the mapper.
      'board_column.sort_key as column_sort_key',
      'task.sort_key as task_sort_key',
      jsonArrayFrom(
        eb
          .selectFrom('task_assignee')
          .select('task_assignee.user_id')
          .whereRef('task_assignee.task_id', '=', 'task.id')
          .orderBy('task_assignee.user_id')
      ).as('assignee_rows'),
      jsonArrayFrom(
        openBlockers(eb, userId)
          .select((ib) => [
            'blocker.id',
            'blocker.project_id',
            'blocker.title',
            jsonArrayFrom(
              ib
                .selectFrom('task_assignee')
                .select('task_assignee.user_id')
                .whereRef('task_assignee.task_id', '=', 'blocker.id')
                .orderBy('task_assignee.user_id')
            ).as('assignee_rows'),
          ])
          .orderBy('blocker.title')
          .orderBy('blocker.id')
      ).as('blocked_by_rows'),
      hiddenEdgeCount(userId, 'blocked_by').as('hidden_blocked_by_count'),
      jsonArrayFrom(
        openDependents(eb, userId)
          .select((ib) => [
            'dependent.id',
            'dependent.project_id',
            'dependent.title',
            jsonArrayFrom(
              ib
                .selectFrom('task_assignee')
                .select('task_assignee.user_id')
                .whereRef('task_assignee.task_id', '=', 'dependent.id')
                .orderBy('task_assignee.user_id')
            ).as('assignee_rows'),
          ])
          .orderBy('dependent.title')
          .orderBy('dependent.id')
      ).as('blocking_rows'),
      hiddenEdgeCount(userId, 'blocking').as('hidden_blocking_count'),
      // The two numbers the bucket is decided by, selected so the ordering can
      // happen in SQL. It has to: the page boundary is applied there, and a
      // LIMIT over board position would hand back an arbitrary thousand cards
      // rather than the thousand the caller most needs, leaving the documented
      // order holding only within a page.
      openBlockers(eb, userId)
        .select((ib) => ib.fn.countAll<string>().as('n'))
        .as('readable_blocker_count'),
      openDependents(eb, userId)
        .innerJoin('task_assignee', 'task_assignee.task_id', 'dependent.id')
        .where('task_assignee.user_id', '!=', userId)
        .select((ib) => ib.fn.count<string>('task_assignee.user_id').distinct().as('n'))
        .as('waiting_user_count'),
    ])
    .where('board_column.is_done', '=', false)
    .where('task.archived_at', 'is', null)
    .where('project.archived_at', 'is', null)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('task_assignee')
          .select('task_assignee.user_id')
          .whereRef('task_assignee.task_id', '=', 'task.id')
          .where('task_assignee.user_id', '=', userId)
      )
    )
    .where(accessibleProjectsFilter(userId));
}

// Ordered in an outer query rather than beside the selects, because Postgres
// will not let an output column name appear inside an ORDER BY expression and
// the bucket is a CASE over two of them. Restating the two subqueries in the
// CASE instead would run each of them twice per card.
function myTasksPage(db: Kysely<DB>, userId: string, offset: number, limit: number) {
  return db
    .selectFrom(myTasksRows(db, userId).as('t'))
    .selectAll()
    .orderBy(
      sql`case
            when t.readable_blocker_count + t.hidden_blocked_by_count > 0 then ${BUCKET_RANK.blocked}
            when t.waiting_user_count > 0 then ${BUCKET_RANK.blocking}
            else ${BUCKET_RANK.ready}
          end`
    )
    .orderBy('waiting_user_count', 'desc')
    .orderBy('project_name')
    .orderBy('project_id')
    .orderBy('column_sort_key')
    .orderBy('task_sort_key')
    .orderBy('id')
    .offset(offset)
    .limit(limit);
}

export async function getMyTasks(
  db: Kysely<DB>,
  userId: string,
  offset = 0
): Promise<MyTasksResponse> {
  // One past the page, so "is there more" costs a row rather than a count over
  // the whole set.
  const rows = await myTasksPage(db, userId, offset, MY_TASKS_PAGE_SIZE + 1).execute();
  const hasMore = rows.length > MY_TASKS_PAGE_SIZE;
  const page: MyTaskRow[] = (hasMore ? rows.slice(0, MY_TASKS_PAGE_SIZE) : rows).map((row) => ({
    id: row.id,
    project_id: row.project_id,
    project_name: row.project_name,
    column_name: row.column_name,
    title: row.title,
    assignee_rows: row.assignee_rows,
    blocked_by_rows: row.blocked_by_rows,
    blocking_rows: row.blocking_rows,
    hidden_blocked_by_count: row.hidden_blocked_by_count,
    hidden_blocking_count: row.hidden_blocking_count,
  }));

  const tasks = bucketAndOrder(page, userId);

  // Grouped from this page's cards only, so a person group never names a card
  // the caller has not been handed. A client walking the pages merges them.
  //
  // An unassigned dependent means nobody is waiting, so it is dropped; an
  // unassigned blocker is the opposite — nothing is moving it along.
  return {
    tasks,
    waiting_on_you: personGroups(
      tasks.flatMap((task) => task.blocking),
      userId,
      { includeUnassigned: false }
    ),
    you_are_waiting_on: personGroups(
      tasks.flatMap((task) => task.blocked_by),
      userId,
      { includeUnassigned: true }
    ),
    next_offset: hasMore ? offset + MY_TASKS_PAGE_SIZE : null,
  };
}
