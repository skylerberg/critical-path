import { api, ApiError, assertOk } from '../api/client';
import { apiMessage } from './apiMessages';
import type { components } from '../api/api.generated';
import type { ProjectAccent } from './accents';
import { newId } from './ids';
import { invitations } from './invitations.svelte';
import { readProjectsSnapshot, saveProjectsSnapshot } from './offline-cache';
import { reorderRankUpdates } from './ranks';
import type { RealtimeEvent } from './realtime-types';
import { canEditProject, type ProjectRole } from './roles';
import { session } from './session.svelte';
import { toasts } from './toasts.svelte';
import { users, type User } from './users.svelte';

export type Project = components['schemas']['ProjectListItem'];
type BoardPayload = components['schemas']['BoardResponse'];
type CreateProject = components['schemas']['CreateProject'];
type PatchProject = components['schemas']['PatchProject'];

export type AddMemberResult =
  | { ok: true; status: 'invited' }
  | { ok: true; status: 'member'; name: string }
  | { ok: false; error: string };

function byCreation(a: Project, b: Project): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

// A project the caller has never reordered has no key, and sorts after every
// one that does rather than interleaving.
function byProjectRank(a: Project, b: Project): number {
  if (a.sort_key !== null && b.sort_key !== null) {
    return a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : byCreation(a, b);
  }
  if (a.sort_key !== null) return -1;
  if (b.sort_key !== null) return 1;
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

/**
 * Every field the API sends, at the value a project that has just come into
 * existence would have. Callers override only what they actually know.
 */
function defaultProject(id: string): Project {
  return {
    id,
    name: '',
    description: '',
    archived_at: null,
    created_by: null,
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
    created_at: new Date().toISOString(),
    open_task_count: 0,
    done_task_count: 0,
    sort_key: null,
    last_seen_at: null,
    has_unseen_changes: false,
  };
}

class ProjectsStore {
  projects = $state<Project[]>([]);
  loaded = $state(false);
  loading = $state(false);
  loadError = $state<string | null>(null);

  #sorted = $derived([...this.projects].sort(byProjectRank));
  active = $derived(this.#sorted.filter((p) => p.archived_at === null));
  archived = $derived(this.#sorted.filter((p) => p.archived_at !== null));

  #stampedSinceLoad = new Set<string>();

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = null;
    this.#stampedSinceLoad.clear();
    try {
      const data = assertOk(await api.GET('/api/projects'));
      // A stamp that landed while this read was in flight is not in its answer,
      // which is what a deep link straight to a board does: adopting the list
      // wholesale would light the dot back up on the board being read.
      this.projects = data.projects.map((p) =>
        this.#stampedSinceLoad.has(p.id) ? { ...p, has_unseen_changes: false } : p
      );
      this.loaded = true;
      const userId = session.user?.id;
      if (userId !== undefined) {
        void saveProjectsSnapshot(userId, this.projects);
      }
    } catch (error) {
      // Unreachable rather than refused: the sidebar is worth more filled in
      // from the last visit than empty behind an error the user cannot act on.
      if (!(error instanceof ApiError) && (await this.#hydrateFromCache())) {
        return;
      }
      this.loadError = apiMessage(error, 'Failed to load projects');
    } finally {
      this.loading = false;
    }
  }

  async #hydrateFromCache(): Promise<boolean> {
    const userId = session.user?.id;
    if (userId === undefined) {
      return false;
    }
    const cached = await readProjectsSnapshot(userId);
    if (cached === null) {
      return false;
    }
    this.projects = cached;
    this.loaded = true;
    this.loadError = null;
    return true;
  }

  reset(): void {
    this.projects = [];
    this.loaded = false;
    this.loading = false;
    this.loadError = null;
    this.#stampedSinceLoad.clear();
  }

  async create(name: string): Promise<string> {
    return this.#create({ id: newId(), name });
  }

  async copy(sourceProjectId: string, name: string): Promise<string> {
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

  async setColor(id: string, color: ProjectAccent | null): Promise<void> {
    await this.#patch(id, { color }, 'Failed to update board color');
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

  // Takes the record, not just an id: someone found by global search is not in
  // the directory yet, and every place a member is rendered reads their name
  // from it — without this they show up as a raw UUID until the next reload.
  async addMember(id: string, user: User): Promise<void> {
    const project = this.projects.find((p) => p.id === id);
    if (
      project === undefined ||
      project.created_by === user.id ||
      project.member_ids.includes(user.id)
    ) {
      return;
    }
    users.upsert(user);
    await this.setMembers(id, [...project.member_ids, user.id]);
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
              // Coalesced: a pod predating roles omits role, and an undefined one
              // reads as a viewer everywhere downstream.
              members: [...p.members, { user_id: user.id, role: role ?? 'editor' }],
            }
      );
      users.invalidateAll();
      return { ok: true, status: 'member', name: user.name };
    } catch (error) {
      const message = apiMessage(error, 'Failed to add member');
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

  async setRank(id: string, sortKey: string): Promise<void> {
    const failure = await this.#putRank(id, sortKey);
    if (failure !== null) {
      await this.#mutationFailed(failure.error, 'Failed to reorder project');
    }
  }

  async reorder(movedId: string, orderedIds: string[]): Promise<void> {
    const byId = new Map(this.projects.map((p) => [p.id, p]));
    const ordered = orderedIds.flatMap((id) => byId.get(id) ?? []);
    const updates = reorderRankUpdates(ordered, movedId);
    const results = await Promise.all(
      updates.map(({ id, sort_key }) => this.#putRank(id, sort_key))
    );
    // One repair for the batch. The first drag on a list nothing has ever ranked
    // restacks every project, so a server that refuses refuses all of them — and
    // repairing per write would stack that many identical toasts over that many
    // reads of the same list.
    const failure = results.find((result) => result !== null);
    if (failure !== undefined && failure !== null) {
      await this.#mutationFailed(failure.error, 'Failed to reorder project');
    }
  }

  // Applies the key and sends it, handing back what refused rather than repairing
  // it: only the caller knows whether this write was on its own or one of a batch.
  async #putRank(id: string, sortKey: string): Promise<{ error: unknown } | null> {
    this.#update(id, (p) => ({ ...p, sort_key: sortKey }));
    try {
      assertOk(
        await api.PUT('/api/projects/{id}/position', {
          params: { path: { id } },
          body: { sort_key: sortKey },
        })
      );
      return null;
    } catch (error) {
      return { error };
    }
  }

  // No toast and no resync on failure, unlike every other write here: nobody
  // asked for this one, and an API pod that predates the marker 404s on every
  // board opened during a rolling deploy. The next load re-derives the truth.
  async markSeen(id: string): Promise<void> {
    this.#clearUnseen(id);
    try {
      assertOk(await api.PUT('/api/projects/{id}/seen', { params: { path: { id } } }));
    } catch {
      // Intentionally silent.
    }
  }

  // Strict clamp, matching the server: with no marker nothing counts as unseen,
  // so a member who has never opened a board gets no dot from a live event
  // either — one rule, so the dot and the in-board highlights cannot disagree.
  // An archived board is one the user has put away and never asks to be looked at.
  markChanged(id: string): void {
    this.#update(id, (p) =>
      p.last_seen_at == null || p.archived_at !== null ? p : { ...p, has_unseen_changes: true }
    );
  }

  applyRealtime(event: RealtimeEvent): void {
    if (event.type === 'project_seen') {
      const { id } = event.data;
      this.#clearUnseen(id);
      return;
    }
    if (event.type === 'project_deleted') {
      const { id } = event.data;
      this.projects = this.projects.filter((p) => p.id !== id);
      return;
    }
    if (event.type === 'project_position_updated') {
      const { id, sort_key } = event.data;
      this.#update(id, (p) => ({ ...p, sort_key }));
      return;
    }
    if (event.type === 'project_created' || event.type === 'project_updated') {
      const incoming = event.data;
      const existing = this.projects.find((p) => p.id === incoming.id);
      const merged = { ...(existing ?? defaultProject(incoming.id)), ...incoming };
      this.projects = existing
        ? this.projects.map((p) => (p.id === incoming.id ? merged : p))
        : [...this.projects, merged];
    }
  }

  async #create(body: CreateProject): Promise<string> {
    const optimistic: Project = {
      ...defaultProject(body.id),
      name: body.name,
      description: body.description ?? '',
      created_by: session.user?.id ?? null,
    };
    this.projects = [...this.projects, optimistic];
    try {
      const payload = assertOk(await api.POST('/api/projects', { body }));
      this.#applyPayload(payload);
      return body.id;
    } catch (error) {
      // Rethrown after the resync so the form can surface the rejection inline.
      await this.load();
      throw error;
    }
  }

  async #patch(id: string, body: PatchProject, failMessage: string): Promise<void> {
    this.#update(id, (p) => ({ ...p, ...body }));
    try {
      const row = assertOk(
        await api.PATCH('/api/projects/{id}', { params: { path: { id } }, body })
      );
      // An API older than a field in the body drops it and still answers 200, so
      // the echo is the only thing telling "applied" apart from "ignored".
      if (Object.keys(body).some((key) => !(key in row))) {
        throw new Error('The server did not apply the change');
      }
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
      sort_key: existing?.sort_key ?? null,
      last_seen_at: existing?.last_seen_at ?? null,
      has_unseen_changes: false,
    };
    if (existing !== undefined) {
      this.#update(project.id, () => project);
    } else {
      this.projects = [...this.projects, project];
    }
  }

  #clearUnseen(id: string): void {
    this.#stampedSinceLoad.add(id);
    this.#update(id, (p) => ({
      ...p,
      has_unseen_changes: false,
      last_seen_at: new Date().toISOString(),
    }));
  }

  #update(id: string, patch: (project: Project) => Project): void {
    this.projects = this.projects.map((p) => (p.id === id ? patch(p) : p));
  }

  async #mutationFailed(error: unknown, fallback: string): Promise<void> {
    toasts.error(apiMessage(error, fallback));
    await this.load();
  }
}

export const projects = new ProjectsStore();
