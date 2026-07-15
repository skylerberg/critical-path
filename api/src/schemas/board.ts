import { type } from 'arktype';
import { nullableTiptapDocSchema } from './tiptap';

export const boardColumnSchema = type({
  id: 'string',
  name: 'string',
  position: 'number',
  is_done: 'boolean',
});

export type BoardColumn = typeof boardColumnSchema.infer;

export const boardLabelSchema = type({
  id: 'string',
  name: 'string',
  color: 'string',
});

export type BoardLabel = typeof boardLabelSchema.infer;

export const boardTaskSchema = type({
  id: 'string',
  column_id: 'string',
  title: 'string',
  description: nullableTiptapDocSchema,
  position: 'number',
  created_at: 'string',
  updated_at: 'string',
  label_ids: 'string[]',
  assignee_ids: 'string[]',
  blocker_ids: 'string[]',
  image_count: 'number',
});

export type BoardTask = typeof boardTaskSchema.infer;
