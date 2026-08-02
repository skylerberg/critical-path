import { type } from 'arktype';
import { finiteNumber } from './common';
import { boardColumnSchema, boardLabelSchema } from './board';
import { nullableTiptapDocSchema, tiptapDocSchema } from './tiptap';

export const publicBoardProjectSchema = type({
  id: 'string',
  name: 'string',
  description: 'string',
});

// Module-private because it now renders identically to the authenticated user
// shape and the schema-name registry throws on two barrel exports with the same
// JSON Schema. Still spelled out, so widening that shape cannot widen this one.
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
  position: finiteNumber,
  due_date: 'string | null',
  label_ids: 'string[]',
  assignee_ids: 'string[]',
  blocker_ids: 'string[]',
  image_count: 'number',
  cover_image_url: 'string | null',
  comment_count: 'number',
});

// Spelled out rather than reusing the authenticated comment shape: the day a
// field is added there, what a stranger receives must stay where it is until
// someone widens it here on purpose.
export const publicBoardCommentSchema = type({
  id: 'string',
  task_id: 'string',
  user_id: 'string',
  body: tiptapDocSchema,
  created_at: 'string',
  updated_at: 'string',
});

export const publicBoardSchema = type({
  project: publicBoardProjectSchema,
  columns: boardColumnSchema.array(),
  tasks: publicBoardTaskSchema.array(),
  labels: boardLabelSchema.array(),
  users: publicBoardUserSchema.array(),
  comments: publicBoardCommentSchema.array(),
});

export type PublicBoard = typeof publicBoardSchema.infer;
