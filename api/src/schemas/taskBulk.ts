import { type } from 'arktype';
import { uuid, boundedUuidArray } from './common';
import { movedTaskSchema } from './columns';
import { archivedTaskSchema } from './tasks';

export const BULK_TASK_LIMIT = 100;

// atLeastLength before the cap rather than boundedUuidArray: that helper ends in
// a morph, and MinLength cannot be applied after a pipe.
const bulkTaskIds = uuid.array().atLeastLength(1).atMostLength(BULK_TASK_LIMIT);

export const bulkTaskIdsSchema = type({
  project_id: uuid,
  task_ids: bulkTaskIds,
});

export const bulkMoveTasksSchema = type({
  project_id: uuid,
  task_ids: bulkTaskIds,
  column_id: uuid,
});

export const bulkTaskLabelsSchema = type({
  project_id: uuid,
  task_ids: bulkTaskIds,
  'add_label_ids?': boundedUuidArray(BULK_TASK_LIMIT),
  'remove_label_ids?': boundedUuidArray(BULK_TASK_LIMIT),
});

export const bulkTaskAssigneesSchema = type({
  project_id: uuid,
  task_ids: bulkTaskIds,
  'add_user_ids?': boundedUuidArray(BULK_TASK_LIMIT),
  'remove_user_ids?': boundedUuidArray(BULK_TASK_LIMIT),
});

export const bulkTaskRelationsSchema = type({
  task_id: 'string',
  label_ids: 'string[]',
  assignee_ids: 'string[]',
  blocker_ids: 'string[]',
});

export type BulkTaskRelations = typeof bulkTaskRelationsSchema.infer;

export const bulkTaskRelationsResponseSchema = type({
  tasks: bulkTaskRelationsSchema.array(),
  skipped_task_ids: 'string[]',
});

export const bulkMovedTasksResponseSchema = type({
  moved_tasks: movedTaskSchema.array(),
  skipped_task_ids: 'string[]',
});

export const bulkArchivedTasksResponseSchema = type({
  tasks: archivedTaskSchema.array(),
  skipped_task_ids: 'string[]',
});
