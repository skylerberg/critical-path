import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { DB } from '../db/types';

type ProjectRef = string | RawBuilder<unknown>;

// The marker must never be coalesced to the membership or project date: with no
// row every comparison is null, which is the rule — nothing is unseen until you
// have opened the board once.
function seenMarker(userId: string, project: ProjectRef): RawBuilder<unknown> {
  return sql`(select seen.last_seen_at from project_user_seen seen
      where seen.user_id = ${userId} and seen.project_id = ${project})`;
}

// One definition of "changed", so the list dot and the per-card highlight can
// never disagree about what it means. Each arm is a predicate on a single task,
// which is what lets the two callers below quantify it differently without
// restating what a change is.
//
// Two silences are deliberate: activity and comments cascade with their task, so
// a deleted or archived card leaves nothing to notice, and `created_at` defaults
// to transaction start, so a long write committing after a stamp sorts below it.
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
// carrying both, because the two forms plan nothing alike. Asked as one, the
// arms correlate only on `changed.id`, and the planner hoists each into a hash
// of everything in task_activity and task_comment that clears the seen marker —
// rebuilt once per project. Measured at ~350k buffer hits and 800ms for a screen
// that should cost single-digit milliseconds; docs/scaling.md carries the
// numbers and the query plans. Split, each arm drives its own (task_id,
// created_at) index and stops at the first hit.
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
