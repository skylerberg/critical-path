import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { AppError } from '../utils/errors';

export function avatarUrl(storageKey: string | null): string | null {
  return storageKey === null ? null : `/api/avatars/${storageKey}`;
}

// Not scoped to boards the caller shares with the owner. An avatar is the same
// key on every board its owner appears on, so a per-board rule would mean a
// lookup per face on a card, and any member of any shared project could ask for
// it anyway. Being signed in is the line.
//
// An anonymous caller gets one only when its owner appears on a published
// board, which is the same rule the pictures on that board follow: without it a
// public board renders its cards with every avatar broken.
export async function assertAvatarReadable(
  db: Kysely<DB>,
  user: { id: string } | undefined,
  storageKey: string
): Promise<void> {
  if (user !== undefined) {
    return;
  }

  const onPublicBoard = await db
    .selectFrom('app_user')
    .select('app_user.id')
    .where('app_user.avatar_storage_key', '=', storageKey)
    .where((eb) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom('project')
            .select('project.id')
            .whereRef('project.created_by', '=', 'app_user.id')
            .where('project.is_public', '=', true)
        ),
        eb.exists(
          eb
            .selectFrom('project_member')
            .innerJoin('project', 'project.id', 'project_member.project_id')
            .select('project.id')
            .whereRef('project_member.user_id', '=', 'app_user.id')
            .where('project.is_public', '=', true)
        ),
      ])
    )
    .executeTakeFirst();

  if (!onPublicBoard) {
    throw new AppError(401, 'Authentication required');
  }
}
