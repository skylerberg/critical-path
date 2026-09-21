import { type } from 'arktype';
import { uuid, stringWithLength, hexColor, sortKey } from './common';

export const createLabelSchema = type({
  id: uuid,
  project_id: uuid,
  name: stringWithLength(1, 100),
  color: hexColor,
  'sort_key?': sortKey,
});

export const patchLabelSchema = type({
  'name?': stringWithLength(1, 100),
  'color?': hexColor,
  'sort_key?': sortKey,
});

// `sort_key` is nullable for one release: the migration that introduced it
// leaves the column nullable so the previous pods' inserts keep working
// through the rolling deploy, and a label those pods wrote reads null until
// the follow-up migration backfills and enforces it.
export const labelSchema = type({
  id: 'string',
  project_id: 'string',
  name: 'string',
  color: 'string',
  sort_key: 'string | null',
});

export type LabelResponse = typeof labelSchema.infer;
