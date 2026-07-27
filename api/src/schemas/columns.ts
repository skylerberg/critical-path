import { type } from 'arktype';
import { uuid, stringWithLength, finiteNumber } from './common';
import { boardTaskSchema } from './board';

export const createColumnSchema = type({
  id: uuid,
  project_id: uuid,
  name: stringWithLength(1, 200),
  position: finiteNumber,
  'is_done?': 'boolean',
});

export const patchColumnSchema = type({
  'name?': stringWithLength(1, 200),
  'position?': finiteNumber,
  'is_done?': 'boolean',
});

export const columnSchema = type({
  id: 'string',
  project_id: 'string',
  name: 'string',
  position: finiteNumber,
  is_done: 'boolean',
  created_at: 'string',
});

export type ColumnResponse = typeof columnSchema.infer;

export const deleteColumnQuerySchema = type({
  'move_tasks_to?': uuid,
});

export const moveColumnTasksSchema = type({
  target_column_id: uuid,
});

export const movedTaskSchema = type({
  id: 'string',
  column_id: 'string',
  position: finiteNumber,
});

export type MovedTask = typeof movedTaskSchema.infer;

export const movedTasksResponseSchema = type({
  moved_tasks: movedTaskSchema.array(),
});

export type MovedTasksResponse = typeof movedTasksResponseSchema.infer;

export const duplicatedColumnResponseSchema = type({
  column: columnSchema,
  tasks: boardTaskSchema.array(),
});

export type DuplicatedColumnResponse = typeof duplicatedColumnResponseSchema.infer;
