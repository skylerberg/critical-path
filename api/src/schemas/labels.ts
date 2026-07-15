import { type } from 'arktype';
import { uuid, stringWithLength, hexColor } from './common';

export const createLabelSchema = type({
  id: uuid,
  project_id: uuid,
  name: stringWithLength(1, 100),
  color: hexColor,
});

export const patchLabelSchema = type({
  'name?': stringWithLength(1, 100),
  'color?': hexColor,
});

export const labelSchema = type({
  id: 'string',
  project_id: 'string',
  name: 'string',
  color: 'string',
});

export type LabelResponse = typeof labelSchema.infer;
