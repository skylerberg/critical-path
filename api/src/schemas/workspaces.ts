import { type } from 'arktype';

// Kept only for the deprecated GET /api/workspaces stub; removed with it in
// the follow-up release.
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
