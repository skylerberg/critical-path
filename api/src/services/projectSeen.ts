import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { DB } from '../db/types';

type ProjectRef = string | RawBuilder<unknown>;

// The marker is a scalar subquery, deliberately never coalesced to a membership
// or project date: with no row every comparison is null and nothing is unseen,
// which is the rule — a board shows no change dots until the member has opened it
// once.
function seenMarker(userId: string, project: ProjectRef): RawBuilder<unknown> {
  return sql`(select seen.last_seen_at from project_user_seen seen
      where seen.user_id = ${userId} and seen.project_id = ${project})`;
}

// The one definition of "changed", so the list dot and the per-card highlight
// cannot disagree about what it means. Each arm is a predicate on a single task,
// which is what lets the callers below quantify it differently without restating
// what a change is.
//
// Two silences are deliberate. Activity and comments cascade with their task, so a
// deleted or archived card leaves nothing to notice; and `created_at` defaults to
// transaction start, so a long write that commits after a stamp still sorts below
// it.
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

// Which cards changed, for one board. Driving from the project's cards and
// probing each is the right shape here: the answer is the card list itself, so
// every card has to be visited anyway.
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
// Each arm gets its own EXISTS over the project's cards rather than one EXISTS
// carrying both, because the two forms do not plan alike. Asked as one, the arms
// correlate only on `changed.id`, and the planner hoists each into a hash of
// everything in task_activity and task_comment past the seen marker, rebuilt once
// per project — measured, that was orders of magnitude more buffer traffic than a
// single screen should need. Split, each arm drives its own (task_id, created_at)
// index and stops at the first hit.
//
// The two forms answer identically: ∃x.(P(x) ∨ Q(x)) is ∃x.P(x) ∨ ∃x.Q(x).
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
