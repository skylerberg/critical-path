import { type } from 'arktype';
import { uuid, email, stringWithLength, isoDateString, finiteNumber } from './common';
import { boardColumnSchema, boardLabelSchema, boardTaskSchema } from './board';
import { userSchema } from './users';

export const projectMemberRole = type("'editor' | 'viewer'");

export const projectMemberSchema = type({
  user_id: 'string',
  role: projectMemberRole,
});

// A key, not a colour: each one resolves in the client to a light and a dark
// value, so the rendering can be retuned for contrast without a data migration.
export const projectAccent = type(
  "'rose' | 'amber' | 'lime' | 'emerald' | 'sky' | 'violet' | 'fuchsia' | 'slate'"
);

export type ProjectAccent = typeof projectAccent.infer;

export const nullableProjectAccentSchema = projectAccent.or('null');

export const projectSchema = type({
  id: 'string',
  name: 'string',
  description: 'string',
  archived_at: 'string | null',
  created_at: 'string',
  created_by: 'string | null',
  member_ids: 'string[]',
  members: projectMemberSchema.array(),
  is_public: 'boolean',
  color: nullableProjectAccentSchema,
});

export type ProjectResponse = typeof projectSchema.infer;

// The last three are answers about the caller, not about the project, so they
// belong to this per-caller list and never to the shared project row.
export const projectListItemSchema = projectSchema.merge({
  open_task_count: 'number',
  done_task_count: 'number',
  position: finiteNumber.or('null'),
  last_seen_at: 'string | null',
  has_unseen_changes: 'boolean',
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
  'is_public?': 'boolean',
  'color?': nullableProjectAccentSchema,
});

export const projectMemberRoleEntrySchema = type({
  user_id: uuid,
  role: projectMemberRole,
});

// An empty user_ids is allowed: the creator has implicit access, so [] makes
// the project personal. An omitted user_ids changes roles only, so a role
// change can never add or remove anyone from a stale client list.
export const setProjectMembersSchema = type({
  'user_ids?': uuid.array().atMostLength(100),
  'roles?': projectMemberRoleEntrySchema.array().atMostLength(100),
});

export const setProjectOwnerSchema = type({
  user_id: uuid,
});

export const setProjectPositionSchema = type({
  position: finiteNumber,
});

export const addProjectMemberByEmailSchema = type({
  email,
  'role?': projectMemberRole,
});

export const projectInvitationParamsSchema = type({
  id: uuid,
  invitationId: uuid,
});

export const projectInvitationSchema = type({
  id: 'string',
  project_id: 'string',
  email: 'string',
  role: projectMemberRole,
  invited_by: 'string',
  created_at: 'string',
  expires_at: 'string',
});

export type ProjectInvitationResponse = typeof projectInvitationSchema.infer;

export const projectInvitationsResponseSchema = type({
  invitations: projectInvitationSchema.array(),
});

// Flat and discriminated by `status` rather than a union of two arms: a
// top-level union renders as oneOf, which both generated clients would have to
// narrow through openapi-fetch.
export const addMemberByEmailResponseSchema = type({
  status: "'member' | 'invited'",
  role: projectMemberRole,
  user: userSchema.or('null'),
  invitation: projectInvitationSchema.or('null'),
});

export const acceptInvitationSchema = type({
  token: type('string').atMostLength(512),
});

export const acceptedInvitationSchema = type({
  project_id: 'string',
  role: projectMemberRole,
});

export const boardPayloadSchema = type({
  project: projectSchema,
  columns: boardColumnSchema.array(),
  tasks: boardTaskSchema.array(),
  labels: boardLabelSchema.array(),
});

export type BoardPayload = typeof boardPayloadSchema.infer;

// Merged rather than folded into the payload itself: the export, the public
// board and the copy all build a BoardPayload with no caller to measure against.
export const boardResponseSchema = boardPayloadSchema.merge({
  changed_task_ids: 'string[]',
});

export type BoardResponse = typeof boardResponseSchema.infer;
