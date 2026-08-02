import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';
import { newId } from './ids';
import { invitations } from './invitations.svelte';
import { reorderPositionUpdates } from './positions';
import type { RealtimeEvent } from './realtime-types';
import { canEditProject, type ProjectRole } from './roles';
import { session } from './session.svelte';
import { toasts } from './toasts.svelte';
import { users } from './users.svelte';

export type Project = components['schemas']['ProjectListItem'];
type BoardPayload = components['schemas']['BoardPayload'];
type CreateProject = components['schemas']['CreateProject'];
type PatchProject = components['schemas']['PatchProject'];

export type AddMemberResult =
  | { ok: true; status: 'invited' }
  | { ok: true; status: 'member'; name: string }
  | { ok: false; error: string };

function byCreation(a: Project, b: Project): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function byPosition(a: Project, b: Project): number {
  if (a.position !== null && b.position !== null) {
    return a.position - b.position || byCreation(a, b);
  }
  if (a.position !== null) {
    return -1;
  }
  if (b.position !== null) {
    return 1;
  }
  return byCreation(a, b);
}

export function isProjectOwner(project: Project): boolean {
  return project.created_by === session.user?.id;
}

// The 'editor' default mirrors what the server stores for an id it has not seen.
function membersForIds(project: Project, userIds: string[]): Project['members'] {
  const roleByUser = new Map(project.members.map((member) => [member.user_id, member.role]));
  return userIds.map((userId) => ({
    user_id: userId,
    role: roleByUser.get(userId) ?? 'editor',
  }));
}

class ProjectsStore {
  projects = $state<Project[]>([]);
  loaded = $state(false);
  loading = $state(false);
  loadError = $state<string | null>(null);

  #sorted = $derived([...this.projects].sort(byPosition));
  active = $derived(this.#sorted.filter((p) => p.archived_at === null));
  archived = $derived(this.#sorted.filter((p) => p.archived_at !== null));

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = null;
    try {
      const data = assertOk(await api.GET('/api/projects'));
      this.projects = data.projects;
      this.loaded = true;
    } catch (error) {
      this.loadError = error instanceof ApiError ? error.message : 'Failed to load projects';
    } finally {
      this.loading = false;
    }
  }

  reset(): void {
    this.projects = [];
    this.loaded = false;
    this.loading = false;
    this.loadError = null;
  }

  async create(name: string): Promise<string | null> {
    return this.#create({ id: newId(), name });
  }

  async copy(sourceProjectId: string, name: string): Promise<string | null> {
    return this.#create({ id: newId(), name, source_project_id: sourceProjectId });
  }

  async rename(id: string, name: string): Promise<void> {
    await this.#patch(id, { name }, 'Failed to rename project');
  }

  async archive(id: string): Promise<void> {
    await this.#patch(id, { archived_at: new Date().toISOString() }, 'Failed to archive project');
  }

  async unarchive(id: string): Promise<void> {
    await this.#patch(id, { archived_at: null }, 'Failed to unarchive project');
  }

  async setPublic(id: string, isPublic: boolean): Promise<void> {
    await this.#patch(id, { is_public: isPublic }, 'Failed to update sharing');
  }

  async remove(id: string): Promise<void> {
    this.projects = this.projects.filter((p) => p.id !== id);
    try {
      assertOk(await api.DELETE('/api/projects/{id}', { params: { path: { id } } }));
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to delete project');
    }
  }

  canEdit(projectId: string): boolean {
    const project = this.projects.find((p) => p.id === projectId);
    return project !== undefined && canEditProject(project, session.user?.id);
  }

  // The board refetches on a rejected write, which is the only thing that notices a
  // demotion whose realtime event never arrived. Without this the list keeps its own
  // stale membership and the management controls it gates stay live.
  adoptMembership(project: Pick<Project, 'id' | 'created_by' | 'member_ids' | 'members'>): void {
    this.#update(project.id, (p) => ({
      ...p,
      created_by: project.created_by,
      member_ids: project.member_ids,
      members: project.members,
    }));
  }

  async setMembers(id: string, userIds: string[]): Promise<void> {
    this.#update(id, (p) => ({
      ...p,
      member_ids: userIds,
      members: membersForIds(p, userIds),
    }));
    try {
      assertOk(
        await api.PUT('/api/projects/{id}/members', {
          params: { path: { id } },
          body: { user_ids: userIds },
        })
      );
      users.invalidateAll();
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to update members');
    }
  }

  // Sends roles alone, never user_ids: with a member list this client may have
  // fetched minutes ago, a full replace would evict anyone added since.
  async setMemberRole(id: string, userId: string, role: ProjectRole): Promise<void> {
    this.#update(id, (p) => ({
      ...p,
      members: p.members.map((member) =>
        member.user_id === userId ? { ...member, role } : member
      ),
    }));
    try {
      assertOk(
        await api.PUT('/api/projects/{id}/members', {
          params: { path: { id } },
          body: { roles: [{ user_id: userId, role }] },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to change role');
    }
  }

  async addMember(id: string, userId: string): Promise<void> {
    const project = this.projects.find((p) => p.id === id);
    if (
      project === undefined ||
      project.created_by === userId ||
      project.member_ids.includes(userId)
    ) {
      return;
    }
    await this.setMembers(id, [...project.member_ids, userId]);
  }

  // An address with no account yields an invitation, not a member: this board
  // gains nobody until it is redeemed.
  async addMemberByEmail(id: string, email: string): Promise<AddMemberResult> {
    try {
      const { status, role, user, invitation } = assertOk(
        await api.POST('/api/projects/{id}/members/by-email', {
          params: { path: { id } },
          body: { email },
        })
      );
      if (status === 'invited' || user === null) {
        if (invitation !== null) {
          invitations.adopt(invitation);
        }
        return { ok: true, status: 'invited' };
      }
      users.upsert(user);
      // The creator is implicit and never listed, mirroring the server's no-op.
      this.#update(id, (p) =>
        p.created_by === user.id || p.member_ids.includes(user.id)
          ? p
          : {
              ...p,
              member_ids: [...p.member_ids, user.id],
              // Coalesced despite the type: an API that predates roles omits it,
              // and an undefined role reads as a viewer everywhere downstream.
              members: [...p.members, { user_id: user.id, role: role ?? 'editor' }],
            }
      );
      users.invalidateAll();
      return { ok: true, status: 'member', name: user.name };
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to add member';
      return { ok: false, error: message };
    }
  }

  async leave(id: string): Promise<void> {
    const project = this.projects.find((p) => p.id === id);
    const selfId = session.user?.id;
    if (project === undefined || selfId === undefined) {
      return;
    }
    const remaining = project.member_ids.filter((memberId) => memberId !== selfId);
    this.projects = this.projects.filter((p) => p.id !== id);
    try {
      assertOk(
        await api.PUT('/api/projects/{id}/members', {
          params: { path: { id } },
          body: { user_ids: remaining },
        })
      );
      users.invalidateAll();
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to leave board');
    }
  }

  async transferOwnership(id: string, userId: string): Promise<void> {
    const selfId = session.user?.id;
    if (selfId === undefined) {
      return;
    }
    this.#update(id, (p) => {
      const memberIds = [
        ...p.member_ids.filter((memberId) => memberId !== userId && memberId !== selfId),
        selfId,
      ];
      return {
        ...p,
        created_by: userId,
        member_ids: memberIds,
        members: membersForIds(p, memberIds),
      };
    });
    try {
      const row = assertOk(
        await api.PUT('/api/projects/{id}/owner', {
          params: { path: { id } },
          body: { user_id: userId },
        })
      );
      this.#update(id, (p) => ({ ...p, ...row }));
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to transfer ownership');
    }
  }

  async setPosition(id: string, position: number): Promise<void> {
    this.#update(id, (p) => ({ ...p, position }));
    try {
      assertOk(
        await api.PUT('/api/projects/{id}/position', {
          params: { path: { id } },
          body: { position },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to reorder project');
    }
  }

  async reorder(movedId: string, orderedIds: string[]): Promise<void> {
    const byId = new Map(this.projects.map((p) => [p.id, p]));
    const ordered = orderedIds.flatMap((id) => byId.get(id) ?? []);
    const updates = reorderPositionUpdates(ordered, movedId);
    await Promise.all(updates.map(({ id, position }) => this.setPosition(id, position)));
  }

  applyRealtime(event: RealtimeEvent): void {
    if (event.type === 'project_deleted') {
      const { id } = event.data as { id: string };
      this.projects = this.projects.filter((p) => p.id !== id);
      return;
    }
    if (event.type === 'project_position_updated') {
      const { id, position } = event.data as { id: string; position: number };
      this.#update(id, (p) => ({ ...p, position }));
      return;
    }
    if (event.type === 'project_created' || event.type === 'project_updated') {
      const incoming = event.data as Partial<Project> & { id: string };
      const existing = this.projects.find((p) => p.id === incoming.id);
      const base: Project = existing ?? {
        id: incoming.id,
        name: '',
        description: '',
        archived_at: null,
        created_by: null,
        member_ids: [],
        members: [],
        is_public: false,
        created_at: new Date().toISOString(),
        open_task_count: 0,
        done_task_count: 0,
        position: null,
      };
      const merged = { ...base, ...incoming };
      this.projects = existing
        ? this.projects.map((p) => (p.id === incoming.id ? merged : p))
        : [...this.projects, merged];
    }
  }

  async #create(body: CreateProject): Promise<string | null> {
    const optimistic: Project = {
      id: body.id,
      name: body.name,
      description: body.description ?? '',
      archived_at: null,
      created_by: session.user?.id ?? null,
      member_ids: [],
      members: [],
      is_public: false,
      created_at: new Date().toISOString(),
      open_task_count: 0,
      done_task_count: 0,
      position: null,
    };
    this.projects = [...this.projects, optimistic];
    try {
      const payload = assertOk(await api.POST('/api/projects', { body }));
      this.#applyPayload(payload);
      return body.id;
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to create project');
      return null;
    }
  }

  async #patch(id: string, body: PatchProject, failMessage: string): Promise<void> {
    this.#update(id, (p) => ({ ...p, ...body }));
    try {
      const row = assertOk(
        await api.PATCH('/api/projects/{id}', { params: { path: { id } }, body })
      );
      this.#update(id, (p) => ({ ...p, ...row }));
    } catch (error) {
      await this.#mutationFailed(error, failMessage);
    }
  }

  #applyPayload(payload: BoardPayload): void {
    const doneColumns = new Set(payload.columns.filter((c) => c.is_done).map((c) => c.id));
    const doneCount = payload.tasks.filter((t) => doneColumns.has(t.column_id)).length;
    const existing = this.projects.find((p) => p.id === payload.project.id);
    const project: Project = {
      ...payload.project,
      open_task_count: payload.tasks.length - doneCount,
      done_task_count: doneCount,
      position: existing?.position ?? null,
    };
    if (existing !== undefined) {
      this.#update(project.id, () => project);
    } else {
      this.projects = [...this.projects, project];
    }
  }

  #update(id: string, patch: (project: Project) => Project): void {
    this.projects = this.projects.map((p) => (p.id === id ? patch(p) : p));
  }

  async #mutationFailed(error: unknown, fallback: string): Promise<void> {
    toasts.error(error instanceof ApiError ? error.message : fallback);
    await this.load();
  }
}

export const projects = new ProjectsStore();
