import type { Kysely, Selectable } from 'kysely';
import type { DB, Project } from '../db/types';
import { normalizeProjectRole, type ProjectRole } from './authorization';
import { publishAfterCommit } from './realtime/index';

export interface ProjectMemberEntry {
  user_id: string;
  role: ProjectRole;
}

export type ProjectRow = Pick<
  Selectable<Project>,
  'id' | 'name' | 'description' | 'archived_at' | 'created_at' | 'created_by' | 'is_public'
>;

export const PROJECT_COLUMNS = [
  'id',
  'name',
  'description',
  'archived_at',
  'created_at',
  'created_by',
  'is_public',
] as const;

// member_ids is redundant with members and is kept only because clients from
// before roles existed read it; it is derived here so the two cannot drift.
export function toProjectResponse(row: ProjectRow, members: ProjectMemberEntry[]) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    archived_at: row.archived_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    created_by: row.created_by,
    member_ids: members.map((member) => member.user_id),
    members,
    is_public: row.is_public,
  };
}

export function toMemberEntries(rows: { user_id: string; role: string }[]): ProjectMemberEntry[] {
  return rows.map((row) => ({ user_id: row.user_id, role: normalizeProjectRole(row.role) }));
}

export async function fetchMembers(
  db: Kysely<DB>,
  projectId: string
): Promise<ProjectMemberEntry[]> {
  return toMemberEntries(
    await db
      .selectFrom('project_member')
      .select(['user_id', 'role'])
      .where('project_id', '=', projectId)
      .orderBy('created_at')
      .orderBy('user_id')
      .execute()
  );
}

async function fetchTaskCounts(
  db: Kysely<DB>,
  projectId: string
): Promise<{ open_task_count: number; done_task_count: number }> {
  const row = await db
    .selectFrom('task')
    .leftJoin('board_column', 'board_column.id', 'task.column_id')
    .select((eb) => [
      eb.fn
        .count<string>('task.id')
        .filterWhere(eb.not(eb.fn.coalesce('board_column.is_done', eb.val(false))))
        .as('open_task_count'),
      eb.fn
        .count<string>('task.id')
        .filterWhere('board_column.is_done', '=', true)
        .as('done_task_count'),
    ])
    .where('task.project_id', '=', projectId)
    .where('task.archived_at', 'is', null)
    .executeTakeFirstOrThrow();
  return {
    open_task_count: Number(row.open_task_count),
    done_task_count: Number(row.done_task_count),
  };
}

// project_created/project_updated carry the projects-list item shape so a
// client that just gained visibility can upsert without a refetch.
export async function publishProjectListItem(
  c: Parameters<typeof publishAfterCommit>[0],
  db: Kysely<DB>,
  row: ProjectRow,
  members: ProjectMemberEntry[]
): Promise<void> {
  publishAfterCommit(
    c,
    'project_updated',
    row.id,
    { ...toProjectResponse(row, members), ...(await fetchTaskCounts(db, row.id)) },
    { broadcast: true }
  );
}
