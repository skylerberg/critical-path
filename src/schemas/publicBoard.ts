import { type } from 'arktype';
import { finiteNumber } from './common';
import { boardColumnSchema, boardLabelSchema } from './board';
import { nullableTiptapDocSchema } from './tiptap';

export const publicBoardProjectSchema = type({
  id: 'string',
  name: 'string',
  description: 'string',
});

export const publicBoardUserSchema = type({
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
  label_ids: 'string[]',
  assignee_ids: 'string[]',
  blocker_ids: 'string[]',
  image_count: 'number',
});

export const publicBoardSchema = type({
  project: publicBoardProjectSchema,
  columns: boardColumnSchema.array(),
  tasks: publicBoardTaskSchema.array(),
  labels: boardLabelSchema.array(),
  users: publicBoardUserSchema.array(),
});

export type PublicBoard = typeof publicBoardSchema.infer;
