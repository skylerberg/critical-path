import { type } from 'arktype';
import { boardColumnSchema, boardLabelSchema } from './board';
import { nullableTiptapDocSchema, tiptapDocSchema } from './tiptap';
import { attachmentSchema } from './attachments';

export const publicBoardProjectSchema = type({
  id: 'string',
  name: 'string',
  description: 'string',
});

// Spelled out rather than reusing the authenticated user shape: the day a field
// is added there, what a stranger receives must stay where it is until someone
// widens it here on purpose.
const publicBoardUserSchema = type({
  id: 'string',
  name: 'string',
  avatar_url: 'string | null',
});

export type PublicBoardUser = typeof publicBoardUserSchema.infer;

export const publicBoardTaskSchema = type({
  id: 'string',
  column_id: 'string',
  title: 'string',
  description: nullableTiptapDocSchema,
  sort_key: 'string',
  due_date: 'string | null',
  label_ids: 'string[]',
  assignee_ids: 'string[]',
  blocker_ids: 'string[]',
  cover_image_url: 'string | null',
  attachment_count: 'number',
  comment_count: 'number',
  checklist_item_count: 'number',
  checklist_done_count: 'number',
});

// Spelled out for the same reason.
export const publicBoardCommentSchema = type({
  id: 'string',
  task_id: 'string',
  user_id: 'string',
  body: tiptapDocSchema,
  created_at: 'string',
  updated_at: 'string',
});

// Spelled out for the same reason; the missing timestamps also keep it from
// colliding with the authenticated item in the schema-name registry.
export const publicBoardChecklistItemSchema = type({
  id: 'string',
  task_id: 'string',
  text: 'string',
  checked: 'boolean',
  sort_key: 'string',
});

export const publicBoardSchema = type({
  project: publicBoardProjectSchema,
  columns: boardColumnSchema.array(),
  tasks: publicBoardTaskSchema.array(),
  labels: boardLabelSchema.array(),
  users: publicBoardUserSchema.array(),
  comments: publicBoardCommentSchema.array(),
  checklist_items: publicBoardChecklistItemSchema.array(),
  attachments: attachmentSchema.array(),
});

export type PublicBoard = typeof publicBoardSchema.infer;
