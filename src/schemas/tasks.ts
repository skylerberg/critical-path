import { type } from 'arktype';
import {
  uuid,
  stringWithLength,
  boundedUuidArray,
  calendarDate,
  finiteNumber,
  isoDateString,
} from './common';
import { nullableTiptapDocSchema } from './tiptap';
import { boardTaskSchema } from './board';
import { imageResponseSchema } from './images';
import { commentSchema } from './comments';
import { checklistItemSchema } from './checklists';
import { attachmentSchema } from './attachments';

export const TASK_TITLE_MIN_LENGTH = 1;
export const TASK_TITLE_MAX_LENGTH = 2000;

const taskTitle = stringWithLength(TASK_TITLE_MIN_LENGTH, TASK_TITLE_MAX_LENGTH);

export const createTaskSchema = type({
  id: uuid,
  project_id: uuid,
  column_id: uuid,
  title: taskTitle,
  'description?': nullableTiptapDocSchema,
  position: finiteNumber,
  'due_date?': calendarDate.or('null'),
  'label_ids?': boundedUuidArray(100),
  'assignee_ids?': boundedUuidArray(100),
});

export const createTasksBatchItemSchema = type({
  id: uuid,
  title: taskTitle,
  position: finiteNumber,
});

export const createTasksBatchSchema = type({
  project_id: uuid,
  column_id: uuid,
  tasks: createTasksBatchItemSchema.array().atLeastLength(1).atMostLength(100),
});

export const tasksBatchResponseSchema = type({ tasks: boardTaskSchema.array() });

export type TasksBatchResponse = typeof tasksBatchResponseSchema.infer;

export const patchTaskSchema = type({
  'title?': taskTitle,
  'description?': nullableTiptapDocSchema,
  'column_id?': uuid,
  'position?': finiteNumber,
  'due_date?': calendarDate.or('null'),
  'expected_updated_at?': isoDateString,
});

export const taskDetailResponseSchema = boardTaskSchema.merge({
  project_id: 'string',
  archived_at: 'string | null',
  images: imageResponseSchema.array(),
  comments: commentSchema.array(),
  checklist_items: checklistItemSchema.array(),
  attachments: attachmentSchema.array(),
});

export type TaskDetailResponse = typeof taskDetailResponseSchema.infer;

export const archivedTaskSchema = boardTaskSchema.merge({ archived_at: 'string' });

export type ArchivedTask = typeof archivedTaskSchema.infer;

export const archivedTasksResponseSchema = type({ tasks: archivedTaskSchema.array() });

export type ArchivedTasksResponse = typeof archivedTasksResponseSchema.infer;

export const addBlockerSchema = type({
  blocker_task_id: uuid,
});

export const setTaskLabelsSchema = type({
  label_ids: boundedUuidArray(100),
});

export const setTaskAssigneesSchema = type({
  user_ids: boundedUuidArray(100),
});

export const setTaskCoverSchema = type({
  image_id: uuid.or('null'),
});

export const taskBlockerParamsSchema = type({
  id: uuid,
  blockerTaskId: uuid,
});
