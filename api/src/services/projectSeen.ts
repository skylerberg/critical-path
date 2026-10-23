import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { DB } from '../db/types';

type ProjectRef = string | RawBuilder<unknown>;

// A missing seen row stays null rather than falling back to the membership or
// project date: null comparisons are never true, and the rule is that nothing
// is unseen until the board has been opened once. A fallback date would dot
// every card that moved since it.
function seenMarker(userId: string, project: ProjectRef): RawBuilder<unknown> {
  return sql`(select seen.last_seen_at from project_user_seen seen
      where seen.user_id = ${userId} and seen.project_id = ${project})`;
}

// The one definition of "changed": each arm is a predicate on a single task, so
// the board-wide and per-card callers below can both ask it without restating
// what a change is.
//
// Two silences are deliberate. Activity and comments cascade with their task, so
// a deleted card leaves nothing to notice. `created_at` defaults to transaction
// start, so a long write that commits after a stamp sorts below it.
function changeArms(
  userId: string,
  seenAt: RawBuilder<unknown>,
  task: RawBuilder<unknown>
): RawBuilder<boolean>[] {
  return [
    sql<boolean>`exists (select 1 from task_activity act
             where act.task_id = ${task}
               and act.actor_user_id <> ${userId}
               and act.created_at > ${seenAt})`,
    sql<boolean>`exists (select 1 from task_comment cmt
             where cmt.task_id = ${task}
               and cmt.user_id <> ${userId}
               and cmt.created_at > ${seenAt})`,
  ];
}

// Which cards changed, for one board. The caller wants the card list itself, so
// probing each card is the cheapest shape.
function changedTasks(userId: string, project: ProjectRef): RawBuilder<{ id: string }> {
  const arms = changeArms(userId, seenMarker(userId, project), sql.ref('changed.id'));
  return sql<{ id: string }>`select changed.id
    from task changed
    where changed.project_id = ${project}
      and changed.archived_at is null
      and (${sql.join(arms, sql` or `)})
    order by changed.id`;
}

// Correlates on `project.id`, so it embeds only in a query selecting from
// `project`. An archived board answers false however much moved in it: a dot
// asks to be looked at, and an archived board is one the user has put away.
//
// Each arm gets its own EXISTS over the project's cards. Folded into one
// EXISTS, the planner hashes every task_activity and task_comment row that
// clears the seen marker, once per project; split, each arm drives its own
// (task_id, created_at) index and stops at the first hit. The two forms answer
// the same question: ∃x.(P(x) ∨ Q(x)) is ∃x.P(x) ∨ ∃x.Q(x).
export function hasUnseenChanges(userId: string): RawBuilder<boolean> {
  const project = sql.ref('project.id');
  const scoped = changeArms(userId, seenMarker(userId, project), sql.ref('changed.id')).map(
    (arm) => sql<boolean>`exists (
      select 1 from task changed
      where changed.project_id = ${project}
        and changed.archived_at is null
        and ${arm})`
  );
  return sql<boolean>`project.archived_at is null and (${sql.join(scoped, sql` or `)})`;
}

export async function changedTaskIds(
  db: Kysely<DB>,
  projectId: string,
  userId: string
): Promise<string[]> {
  const { rows } = await changedTasks(userId, projectId).execute(db);
  return rows.map((row) => row.id);
}
