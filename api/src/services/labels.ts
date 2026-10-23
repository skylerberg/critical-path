import type { Kysely, Selectable } from 'kysely';
import type { DB, Label } from '../db/types';
import { AppError } from '../utils/errors';
import { assertProjectWrite } from './authorization';

export const LABEL_NOT_FOUND = 'Label not found';

// A caller with no access to the label's project gets the same 404 as one asking
// for a label that does not exist; a viewer of the project gets 403.
export async function assertLabelWrite(
  db: Kysely<DB>,
  userId: string,
  labelId: string
): Promise<Selectable<Label>> {
  const label = await db
    .selectFrom('label')
    .selectAll()
    .where('id', '=', labelId)
    .executeTakeFirst();
  if (!label) {
    throw new AppError(404, LABEL_NOT_FOUND);
  }
  await assertProjectWrite(db, userId, label.project_id, LABEL_NOT_FOUND);
  return label;
}
