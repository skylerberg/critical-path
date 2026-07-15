import { type } from 'arktype';
import { uuid, email, stringWithLength } from './common';
import { userSchema } from './users';

export const workspaceSchema = type({
  id: 'string',
  name: 'string',
  created_by: 'string',
  created_at: 'string',
  member_ids: 'string[]',
});

export type WorkspaceResponse = typeof workspaceSchema.infer;

export const workspacesListResponseSchema = type({
  workspaces: workspaceSchema.array(),
});

export type WorkspacesListResponse = typeof workspacesListResponseSchema.infer;

export const createWorkspaceSchema = type({
  id: uuid,
  name: stringWithLength(1, 200),
});

export const patchWorkspaceSchema = type({
  'name?': stringWithLength(1, 200),
});

// Never empty: the member set must always include the caller.
export const setWorkspaceMembersSchema = type({
  user_ids: uuid.array().atLeastLength(1).atMostLength(100),
});

export const addWorkspaceMemberByEmailSchema = type({
  email,
});

export const workspaceMemberUserResponseSchema = type({
  user: userSchema,
});

export type WorkspaceMemberUserResponse = typeof workspaceMemberUserResponseSchema.infer;
