import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { stripAssigneesForRemovedMembers } from './assigneeStrip';
import type { publishAfterCommit } from './realtime/index';
import { recordAssigneeChanges } from './taskActivity';
import { fetchTaskRelations, publishTaskRelationsSet } from './taskRelations';

// Losing membership has to take the assignments with it: an assignee with no
// access is a card nobody can be asked about, and the seen marker of someone who
// can no longer open the board is a row no request will ever clear.
export async function removeProjectMembers(
  c: Parameters<typeof publishAfterCommit>[0],
  db: Kysely<DB>,
  project: { id: string },
  actorUserId: string,
  removed: string[]
): Promise<void> {
  await db
    .deleteFrom('project_member')
    .where('project_id', '=', project.id)
    .where('user_id', 'in', removed)
    .execute();
  await db
    .deleteFrom('project_user_seen')
    .where('project_id', '=', project.id)
    .where('user_id', 'in', removed)
    .execute();
  const stripped = await stripAssigneesForRemovedMembers(db, project.id, removed);
  await recordAssigneeChanges(
    db,
    actorUserId,
    stripped.map((entry) => ({
      taskId: entry.task_id,
      kind: 'assignee_removed' as const,
      userId: entry.user_id,
    }))
  );
  const strippedTaskIds = [...new Set(stripped.map((entry) => entry.task_id))];
  publishTaskRelationsSet(c, await fetchTaskRelations(db, strippedTaskIds));
}
