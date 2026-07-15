import { type } from 'arktype';
import { uuid, stringWithLength, boundedUuidArray } from './common';
import { nullableTiptapDocSchema } from './tiptap';
import { boardTaskSchema } from './board';
import { imageResponseSchema } from './images';

export const createTaskSchema = type({
  id: uuid,
  project_id: uuid,
  column_id: uuid,
  title: stringWithLength(1, 500),
  'description?': nullableTiptapDocSchema,
  position: 'number',
  'label_ids?': boundedUuidArray(100),
  'assignee_ids?': boundedUuidArray(100),
});

export const patchTaskSchema = type({
  'title?': stringWithLength(1, 500),
  'description?': nullableTiptapDocSchema,
  'column_id?': uuid,
  'position?': 'number',
});

export const taskDetailResponseSchema = boardTaskSchema.merge({
  project_id: 'string',
  images: imageResponseSchema.array(),
});

export type TaskDetailResponse = typeof taskDetailResponseSchema.infer;

export const addBlockerSchema = type({
  blocker_task_id: uuid,
});

export const setTaskLabelsSchema = type({
  label_ids: boundedUuidArray(100),
});

export const setTaskAssigneesSchema = type({
  user_ids: boundedUuidArray(100),
});

export const taskBlockerParamsSchema = type({
  id: uuid,
  blockerTaskId: uuid,
});
