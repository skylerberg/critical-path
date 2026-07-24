import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';
import { newId } from './ids';
import type { RealtimeEvent } from './realtime-types';
import { session } from './session.svelte';
import { toasts } from './toasts.svelte';
import { users } from './users.svelte';

export type Project = components['schemas']['ProjectListItem'];
type BoardPayload = components['schemas']['BoardPayload'];
type CreateProject = components['schemas']['CreateProject'];
type PatchProject = components['schemas']['PatchProject'];

export interface AddMemberResult {
  ok: boolean;
  error?: string;
}

function byCreation(a: Project, b: Project): number {
  return a.created_at.localeCompare(b.created_at) || a.name.localeCompare(b.name);
}

class ProjectsStore {
  projects = $state<Project[]>([]);
  loaded = $state(false);
  loading = $state(false);
  loadError = $state<string | null>(null);

  #sorted = $derived([...this.projects].sort(byCreation));
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

  async remove(id: string): Promise<void> {
    this.projects = this.projects.filter((p) => p.id !== id);
    try {
      assertOk(await api.DELETE('/api/projects/{id}', { params: { path: { id } } }));
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to delete project');
    }
  }

  async setMembers(id: string, userIds: string[]): Promise<void> {
    this.#update(id, (p) => ({ ...p, member_ids: userIds }));
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

  async addMemberByEmail(id: string, email: string): Promise<AddMemberResult> {
    try {
      const { user } = assertOk(
        await api.POST('/api/projects/{id}/members/by-email', {
          params: { path: { id } },
          body: { email },
        })
      );
      users.upsert(user);
      // The creator is implicit and never listed, mirroring the server's no-op.
      this.#update(id, (p) =>
        p.created_by === user.id || p.member_ids.includes(user.id)
          ? p
          : { ...p, member_ids: [...p.member_ids, user.id] }
      );
      users.invalidateAll();
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return { ok: false, error: 'No user with that email' };
      }
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

  applyRealtime(event: RealtimeEvent): void {
    if (event.type === 'project_deleted') {
      const { id } = event.data as { id: string };
      this.projects = this.projects.filter((p) => p.id !== id);
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
        created_at: new Date().toISOString(),
        open_task_count: 0,
        done_task_count: 0,
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
      created_at: new Date().toISOString(),
      open_task_count: 0,
      done_task_count: 0,
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
    const project: Project = {
      ...payload.project,
      open_task_count: payload.tasks.length - doneCount,
      done_task_count: doneCount,
    };
    if (this.projects.some((p) => p.id === project.id)) {
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
