import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';
import { newId } from './ids';
import { projects } from './projects.svelte';
import type { RealtimeEvent } from './realtime-types';
import { session } from './session.svelte';
import { toasts } from './toasts.svelte';
import { users } from './users.svelte';

export type Workspace = components['schemas']['Workspace'];

export interface AddMemberResult {
  ok: boolean;
  error?: string;
}

function byName(a: Workspace, b: Workspace): number {
  return a.name.localeCompare(b.name);
}

class WorkspacesStore {
  workspaces = $state<Workspace[]>([]);
  #byId = $derived(new Map(this.workspaces.map((w) => [w.id, w])));
  #loaded = false;
  #inflight: Promise<void> | null = null;

  byId(id: string): Workspace | undefined {
    return this.#byId.get(id);
  }

  async load(): Promise<void> {
    if (this.#loaded) {
      return;
    }
    this.#inflight ??= this.#fetch().finally(() => {
      this.#inflight = null;
    });
    await this.#inflight;
  }

  loadWithRetry(onFirstError: () => void): () => void {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 2000;
    let errored = false;
    const attempt = (): void => {
      void this.load().catch(() => {
        if (cancelled) {
          return;
        }
        if (!errored) {
          errored = true;
          onFirstError();
        }
        timer = setTimeout(attempt, delay);
        delay = Math.min(delay * 2, 30_000);
      });
    };
    attempt();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }

  reset(): void {
    this.workspaces = [];
    this.#loaded = false;
  }

  async create(name: string): Promise<string | null> {
    const id = newId();
    const creatorId = session.user?.id ?? '';
    const optimistic: Workspace = {
      id,
      name,
      created_by: creatorId,
      created_at: new Date().toISOString(),
      member_ids: creatorId === '' ? [] : [creatorId],
    };
    this.workspaces = [...this.workspaces, optimistic].sort(byName);
    try {
      const row = assertOk(await api.POST('/api/workspaces', { body: { id, name } }));
      this.#replace(id, row);
      return id;
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to create workspace');
      return null;
    }
  }

  async rename(id: string, name: string): Promise<void> {
    this.#update(id, (w) => ({ ...w, name }));
    this.workspaces = [...this.workspaces].sort(byName);
    try {
      const row = assertOk(
        await api.PATCH('/api/workspaces/{id}', { params: { path: { id } }, body: { name } })
      );
      this.#replace(id, row);
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to rename workspace');
    }
  }

  async remove(id: string): Promise<void> {
    this.workspaces = this.workspaces.filter((w) => w.id !== id);
    projects.clearWorkspace(id);
    try {
      assertOk(await api.DELETE('/api/workspaces/{id}', { params: { path: { id } } }));
    } catch (error) {
      // The projects were optimistically detached too, so resync them alongside the list.
      await Promise.all([
        this.#mutationFailed(error, 'Failed to delete workspace'),
        projects.load(),
      ]);
    }
  }

  async setMembers(id: string, userIds: string[]): Promise<void> {
    this.#update(id, (w) => ({ ...w, member_ids: userIds }));
    try {
      assertOk(
        await api.PUT('/api/workspaces/{id}/members', {
          params: { path: { id } },
          body: { user_ids: userIds },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to update members');
    }
  }

  async addMemberByEmail(id: string, email: string): Promise<AddMemberResult> {
    try {
      const { user } = assertOk(
        await api.POST('/api/workspaces/{id}/members/by-email', {
          params: { path: { id } },
          body: { email },
        })
      );
      users.upsert(user);
      this.#update(id, (w) =>
        w.member_ids.includes(user.id) ? w : { ...w, member_ids: [...w.member_ids, user.id] }
      );
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return { ok: false, error: 'No user with that email' };
      }
      const message = error instanceof ApiError ? error.message : 'Failed to add member';
      return { ok: false, error: message };
    }
  }

  applyRealtime(event: RealtimeEvent): void {
    if (event.type === 'workspace_deleted') {
      const { id } = event.data as { id: string };
      this.workspaces = this.workspaces.filter((w) => w.id !== id);
      return;
    }
    if (
      event.type === 'workspace_created' ||
      event.type === 'workspace_updated' ||
      event.type === 'workspace_members_set'
    ) {
      const incoming = event.data as Workspace;
      // A members-set that drops the caller reaches them only to signal removal;
      // the workspace is no longer theirs to list.
      if (event.type === 'workspace_members_set' && session.user !== null) {
        if (!incoming.member_ids.includes(session.user.id)) {
          this.workspaces = this.workspaces.filter((w) => w.id !== incoming.id);
          return;
        }
      }
      this.workspaces = (
        this.workspaces.some((w) => w.id === incoming.id)
          ? this.workspaces.map((w) => (w.id === incoming.id ? incoming : w))
          : [...this.workspaces, incoming]
      ).sort(byName);
    }
  }

  async #fetch(): Promise<void> {
    const data = assertOk(await api.GET('/api/workspaces'));
    this.workspaces = [...data.workspaces].sort(byName);
    this.#loaded = true;
  }

  #update(id: string, patch: (workspace: Workspace) => Workspace): void {
    this.workspaces = this.workspaces.map((w) => (w.id === id ? patch(w) : w));
  }

  #replace(id: string, row: Workspace): void {
    this.workspaces = this.workspaces.map((w) => (w.id === id ? row : w)).sort(byName);
  }

  async #mutationFailed(error: unknown, fallback: string): Promise<void> {
    toasts.error(error instanceof ApiError ? error.message : fallback);
    this.#loaded = false;
    await this.load();
  }
}

export const workspaces = new WorkspacesStore();
