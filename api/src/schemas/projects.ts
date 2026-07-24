import { type } from 'arktype';
import { uuid, email, stringWithLength, isoDateString, finiteNumber } from './common';
import { boardColumnSchema, boardLabelSchema, boardTaskSchema } from './board';
import { userSchema } from './users';

export const projectSchema = type({
  id: 'string',
  name: 'string',
  description: 'string',
  archived_at: 'string | null',
  created_at: 'string',
  created_by: 'string | null',
  member_ids: 'string[]',
});

export type ProjectResponse = typeof projectSchema.infer;

export const projectListItemSchema = projectSchema.merge({
  open_task_count: 'number',
  done_task_count: 'number',
  position: finiteNumber.or('null'),
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
  'source_project_id?': uuid,
});

export const patchProjectSchema = type({
  'name?': stringWithLength(1, 200),
  'description?': stringWithLength(0, 10000),
  'archived_at?': isoDateString.or('null'),
});

// Empty is allowed: the creator has implicit access, so [] makes it personal.
export const setProjectMembersSchema = type({
  user_ids: uuid.array().atMostLength(100),
});

export const setProjectPositionSchema = type({
  position: finiteNumber,
});

export const addProjectMemberByEmailSchema = type({
  email,
});

export const projectMemberUserResponseSchema = type({
  user: userSchema,
});

export type ProjectMemberUserResponse = typeof projectMemberUserResponseSchema.infer;

export const boardPayloadSchema = type({
  project: projectSchema,
  columns: boardColumnSchema.array(),
  tasks: boardTaskSchema.array(),
  labels: boardLabelSchema.array(),
});

export type BoardPayload = typeof boardPayloadSchema.infer;
