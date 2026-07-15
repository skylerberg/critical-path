import { type } from 'arktype';
import { uuid, stringWithLength, isoDateString } from './common';
import { boardColumnSchema, boardLabelSchema, boardTaskSchema } from './board';

export const projectSchema = type({
  id: 'string',
  name: 'string',
  description: 'string',
  is_template: 'boolean',
  archived_at: 'string | null',
  created_at: 'string',
  created_by: 'string | null',
  workspace_id: 'string | null',
});

export type ProjectResponse = typeof projectSchema.infer;

export const projectListItemSchema = projectSchema.merge({
  open_task_count: 'number',
  done_task_count: 'number',
});

export type ProjectListItem = typeof projectListItemSchema.infer;

export const projectsListResponseSchema = type({
  projects: projectListItemSchema.array(),
});

export type ProjectsListResponse = typeof projectsListResponseSchema.infer;

export const createProjectSchema = type({
  id: uuid,
  name: stringWithLength(1, 200),
  'description?': stringWithLength(0, 10000),
  'is_template?': 'boolean',
  'source_project_id?': uuid,
});

export const patchProjectSchema = type({
  'name?': stringWithLength(1, 200),
  'description?': stringWithLength(0, 10000),
  'is_template?': 'boolean',
  'archived_at?': isoDateString.or('null'),
  'workspace_id?': uuid.or('null'),
});

export const boardPayloadSchema = type({
  project: projectSchema,
  columns: boardColumnSchema.array(),
  tasks: boardTaskSchema.array(),
  labels: boardLabelSchema.array(),
});

export type BoardPayload = typeof boardPayloadSchema.infer;
