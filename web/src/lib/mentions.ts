import { untrack } from 'svelte';
import { board } from './board.svelte';
import { projects } from './projects.svelte';
import { users, type User } from './users.svelte';

const MAX_SUGGESTIONS = 8;

export interface MentionProject {
  created_by: string | null;
  member_ids: string[];
}

// The project-scoped user list also carries people who merely still have an
// assignment, a comment or a log entry on the board; offering them would suggest
// access they do not have.
export function projectMentionCandidates(
  project: MentionProject | null | undefined,
  projectUsers: User[]
): User[] {
  if (project == null) return [];
  return projectUsers.filter(
    (user) => user.id === project.created_by || project.member_ids.includes(user.id)
  );
}

export function filterMentionCandidates(
  candidates: User[],
  query: string,
  limit = MAX_SUGGESTIONS
): User[] {
  const needle = query.trim().toLowerCase();
  return candidates
    .filter((user) => needle === '' || user.name.toLowerCase().includes(needle))
    .slice(0, limit);
}

// The live name renders a rename correctly and makes a hand-written label inert
// for anyone in the project. Untracked because this runs inside ProseMirror's
// rendering, which would otherwise re-enter every editor on a users-store settle.
export function mentionLabel(attrs: Record<string, unknown>): string {
  const id = attrs.id;
  const live = typeof id === 'string' ? untrack(() => users.byId(id)) : undefined;
  if (live !== undefined && live.name !== '') return live.name;
  return typeof attrs.label === 'string' ? attrs.label : '';
}

// Membership comes from the projects store, which every membership mutation
// keeps current; the board's copy of the project is loaded once and never
// updated, so someone added during the session would be filtered back out.
export function currentProjectMentionCandidates(): User[] {
  const projectId = board.currentProjectId;
  if (projectId === null) return [];
  const project = projects.projects.find((p) => p.id === projectId) ?? board.project;
  return projectMentionCandidates(project, users.forProject(projectId));
}
