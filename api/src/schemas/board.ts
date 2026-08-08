import { type } from 'arktype';
import { nullableTiptapDocSchema } from './tiptap';

export const boardColumnSchema = type({
  id: 'string',
  name: 'string',
  sort_key: 'string',
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
  sort_key: 'string',
  due_date: 'string | null',
  created_at: 'string',
  updated_at: 'string',
  column_since: 'string',
  label_ids: 'string[]',
  assignee_ids: 'string[]',
  blocker_ids: 'string[]',
  // Same-project blockers are named; blockers in other projects reach the card
  // only as this count, so a board read never joins across the boundary and the
  // remote side stays unidentified.
  open_cross_project_blocker_count: 'number',
  cover_image_url: 'string | null',
  comment_count: 'number',
  checklist_item_count: 'number',
  checklist_done_count: 'number',
  attachment_count: 'number',
});

export type BoardTask = typeof boardTaskSchema.infer;
