import { type } from 'arktype';
import { uuid, stringWithLength, sortKey } from './common';
import { boardTaskSchema } from './board';

export const createColumnSchema = type({
  id: uuid,
  project_id: uuid,
  name: stringWithLength(1, 200),
  'sort_key?': sortKey,
  'is_done?': 'boolean',
});

export const patchColumnSchema = type({
  'name?': stringWithLength(1, 200),
  'sort_key?': sortKey,
  'is_done?': 'boolean',
});

export const columnSchema = type({
  id: 'string',
  project_id: 'string',
  name: 'string',
  sort_key: 'string',
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

// The full ordered id list of a column's unarchived tasks, in their new order;
// the server re-stamps evenly spread keys so a one-shot sort commits to manual
// order rather than acting as a persistent view mode.
export const reorderColumnTasksSchema = type({
  task_ids: uuid.array().atLeastLength(1),
});

export const movedTaskSchema = type({
  id: 'string',
  column_id: 'string',
  sort_key: 'string',
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
