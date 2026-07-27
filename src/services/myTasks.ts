import type { Kysely } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB } from '../db/types';
import type { MyTask, MyTaskLink, MyTaskPersonGroup, MyTasksResponse } from '../schemas/index';
import { accessibleProjectsFilter } from './authorization';

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
    const waitingUserIds = [...new Set(blocking.flatMap((link) => link.assignee_ids))]
      .filter((id) => id !== userId)
      .sort();
    return {
      id: row.id,
      project_id: row.project_id,
      project_name: row.project_name,
      column_name: row.column_name,
      title: row.title,
      assignee_ids: row.assignee_rows.map((assignee) => assignee.user_id),
      bucket: blockedBy.length > 0 ? 'blocked' : waitingUserIds.length > 0 ? 'blocking' : 'ready',
      waiting_user_ids: waitingUserIds,
      blocking,
      blocked_by: blockedBy,
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

function myTasksQuery(db: Kysely<DB>, userId: string) {
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
      jsonArrayFrom(
        eb
          .selectFrom('task_assignee')
          .select('task_assignee.user_id')
          .whereRef('task_assignee.task_id', '=', 'task.id')
          .orderBy('task_assignee.user_id')
      ).as('assignee_rows'),
      jsonArrayFrom(
        eb
          .selectFrom('task_dependency')
          .innerJoin('task as blocker', 'blocker.id', 'task_dependency.blocker_task_id')
          .innerJoin('board_column as blocker_column', 'blocker_column.id', 'blocker.column_id')
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
          .whereRef('task_dependency.blocked_task_id', '=', 'task.id')
          .where('blocker_column.is_done', '=', false)
          .where('blocker.archived_at', 'is', null)
          .orderBy('blocker.title')
          .orderBy('blocker.id')
      ).as('blocked_by_rows'),
      jsonArrayFrom(
        eb
          .selectFrom('task_dependency')
          .innerJoin('task as dependent', 'dependent.id', 'task_dependency.blocked_task_id')
          .innerJoin(
            'board_column as dependent_column',
            'dependent_column.id',
            'dependent.column_id'
          )
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
          .whereRef('task_dependency.blocker_task_id', '=', 'task.id')
          .where('dependent_column.is_done', '=', false)
          .where('dependent.archived_at', 'is', null)
          .orderBy('dependent.title')
          .orderBy('dependent.id')
      ).as('blocking_rows'),
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
    .where(accessibleProjectsFilter(userId))
    .orderBy('project.name')
    .orderBy('project.id')
    .orderBy('task.position')
    .orderBy('task.id');
}

export async function getMyTasks(db: Kysely<DB>, userId: string): Promise<MyTasksResponse> {
  const rows: MyTaskRow[] = await myTasksQuery(db, userId).execute();
  const tasks = bucketAndOrder(rows, userId);

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
  };
}
