import type { Project } from './projects.svelte';
import type { Workspace } from './workspaces.svelte';

export interface WorkspaceGroup {
  workspace: Workspace;
  projects: Project[];
}

export interface ProjectGroups {
  personal: Project[];
  workspaces: WorkspaceGroup[];
}

// Projects whose workspace_id points at a workspace the caller can't see (e.g. just
// after a workspace delete, before the list refetches) fall back to Personal.
export function groupProjectsByWorkspace(
  projectList: Project[],
  workspaceList: Workspace[]
): ProjectGroups {
  const known = new Set(workspaceList.map((w) => w.id));
  const personal = projectList.filter((p) => p.workspace_id === null || !known.has(p.workspace_id));
  const workspaces = [...workspaceList]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((workspace) => ({
      workspace,
      projects: projectList.filter((p) => p.workspace_id === workspace.id),
    }));
  return { personal, workspaces };
}
