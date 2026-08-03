import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { DB } from '../db/types';

type ProjectRef = string | RawBuilder<unknown>;

// One definition of "changed", so the list dot and the per-card highlight can
// never disagree about what it means.
//
// The marker must never be coalesced to the membership or project date: with no
// row every comparison is null, which is the rule — nothing is unseen until you
// have opened the board once.
//
// Two silences are deliberate. Activity and comments cascade with their task, so
// a deleted or archived card leaves nothing to notice; and `created_at` defaults
// to transaction start, so a long write committing after a stamp sorts below it.
// Both lose a highlight, neither invents one.
function changedTasks(userId: string, project: ProjectRef): RawBuilder<{ id: string }> {
  const seenAt = sql`(select seen.last_seen_at from project_user_seen seen
      where seen.user_id = ${userId} and seen.project_id = ${project})`;
  return sql<{ id: string }>`select changed.id
    from task changed
    where changed.project_id = ${project}
      and changed.archived_at is null
      and (exists (select 1 from task_activity act
             where act.task_id = changed.id
               and act.actor_user_id <> ${userId}
               and act.created_at > ${seenAt})
        or exists (select 1 from task_comment cmt
             where cmt.task_id = changed.id
               and cmt.user_id <> ${userId}
               and cmt.created_at > ${seenAt}))
    order by changed.id`;
}

// Correlates on `project.id`, so it embeds only in a query selecting from
// `project`. An archived board answers false however much moved in it: a dot
// asks to be looked at, and an archived board is one the user has put away.
export function hasUnseenChanges(userId: string): RawBuilder<boolean> {
  return sql<boolean>`project.archived_at is null
    and exists (${changedTasks(userId, sql.ref('project.id'))})`;
}

export async function changedTaskIds(
  db: Kysely<DB>,
  projectId: string,
  userId: string
): Promise<string[]> {
  const { rows } = await changedTasks(userId, projectId).execute(db);
  return rows.map((row) => row.id);
}
