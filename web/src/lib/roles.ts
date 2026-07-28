import type { components } from '../api/api.generated';

export type ProjectRole = components['schemas']['ProjectMember']['role'];

// `members` is optional even though the payload types make it required: a
// response from an API pod that predates roles has no such key, and this is read
// during render, where a TypeError takes the whole board down.
interface RoleReadable {
  created_by: string | null;
  member_ids: string[];
  members?: { user_id: string; role: ProjectRole }[];
}

export function roleFor(project: RoleReadable, userId: string | undefined): ProjectRole | null {
  if (userId === undefined) {
    return null;
  }
  if (project.created_by === userId) {
    return 'editor';
  }
  const entry = project.members?.find((member) => member.user_id === userId);
  if (entry !== undefined) {
    // Fail closed, matching the server: a role this release does not know of is
    // not an editor.
    return entry.role === 'editor' ? 'editor' : 'viewer';
  }
  // The only payload that lists a member without a role predates roles entirely,
  // and back then every member was an editor. Failing closed here would blank
  // editing for every non-creator for the length of a rollout.
  return project.member_ids.includes(userId) ? 'editor' : null;
}

export function canEditProject(project: RoleReadable, userId: string | undefined): boolean {
  return roleFor(project, userId) === 'editor';
}
