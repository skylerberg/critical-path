import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { MAX_TASKS_PER_PROJECT } from '../config/constants';
import { AppError } from '../utils/errors';

async function countTasksInProject(db: Kysely<DB>, projectId: string): Promise<number> {
  const { count } = await db
    .selectFrom('task')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('task.project_id', '=', projectId)
    .executeTakeFirstOrThrow();
  return Number(count);
}

export function taskCapMessage(adding: number): string {
  return adding === 1
    ? `Project already holds the maximum of ${String(MAX_TASKS_PER_PROJECT)} tasks`
    : `Project cannot hold ${String(adding)} more tasks: the maximum is ${String(MAX_TASKS_PER_PROJECT)}`;
}

// No lock on the project row, unlike the webhook and series caps. Those gate a
// rare operation; this gates the hottest write in the product, and serializing
// every card a board creates behind one row lock would cost far more than the
// overshoot it prevents. Concurrent creates can therefore land a handful of rows
// past the ceiling, which is acceptable: this is a denial-of-service guard, not an
// invariant anything reads back.
export async function assertTaskCapacity(
  db: Kysely<DB>,
  projectId: string,
  adding: number
): Promise<void> {
  if (adding <= 0) return;
  if ((await countTasksInProject(db, projectId)) + adding > MAX_TASKS_PER_PROJECT) {
    throw new AppError(422, taskCapMessage(adding));
  }
}

// Takes the project row, which the copy and duplicate paths can afford: they are
// rare and already expensive. It excludes other bulk copies of the same project,
// not concurrent single creates — those take no lock by design — which is what
// stops two duplications of a nearly-full board both reading a pre-cap count and
// both landing thousands of rows.
export async function assertLockedTaskCapacity(
  db: Kysely<DB>,
  projectId: string,
  adding: number
): Promise<void> {
  if (adding <= 0) return;
  await db
    .selectFrom('project')
    .select('project.id')
    .where('project.id', '=', projectId)
    .forUpdate()
    .executeTakeFirst();
  await assertTaskCapacity(db, projectId, adding);
}
