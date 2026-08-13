import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';
import { readUsersSnapshot, saveUsersSnapshot } from './offline-cache';
import { session } from './session.svelte';

export type User = components['schemas']['User'];

function byName(a: User, b: User): number {
  return a.name.localeCompare(b.name);
}

// `displayFor` yields a nameless placeholder for a user the caller can no longer see,
// which renders as a blank label wherever a name is shown as text.
export function displayName(user: User): string {
  return user.name === '' ? 'Unknown user' : user.name;
}

class UsersStore {
  users = $state<User[]>([]);
  #projectUsers = $state<Record<string, User[]>>({});
  #byId = $derived(
    new Map<string, User>([
      ...Object.values(this.#projectUsers).flatMap((list) => list.map((u) => [u.id, u] as const)),
      ...this.users.map((u) => [u.id, u] as const),
    ])
  );
  #loaded = false;
  #inflight: Promise<void> | null = null;
  #projectInflight = new Map<string, Promise<void>>();

  // Undefined for a user this account cannot see, which is what a byline wants:
  // leaving them unnamed beats `displayFor`'s placeholder rendering as "Unknown
  // user" against a teammate the activity log has just named.
  byId(id: string): User | undefined {
    return this.#byId.get(id);
  }

  // A user who is no longer visible (e.g. an assignee who lost project access)
  // still needs to render, so callers get a neutral placeholder instead of undefined.
  displayFor(id: string): User {
    return this.#byId.get(id) ?? { id, name: '', avatar_url: null };
  }

  forProject(projectId: string): User[] {
    return this.#projectUsers[projectId] ?? [];
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

  async loadForProject(projectId: string): Promise<void> {
    if (projectId in this.#projectUsers) {
      return;
    }
    let inflight = this.#projectInflight.get(projectId);
    if (inflight === undefined) {
      inflight = this.#fetchForProject(projectId)
        .catch(() => {
          // Best-effort: leave the project uncached so the next open retries.
        })
        .finally(() => {
          this.#projectInflight.delete(projectId);
        });
      this.#projectInflight.set(projectId, inflight);
    }
    await inflight;
  }

  async refresh(): Promise<void> {
    await this.#fetch();
  }

  setForProject(projectId: string, list: User[]): void {
    this.#projectUsers = { ...this.#projectUsers, [projectId]: [...list].sort(byName) };
  }

  // Drop the project-scoped cache so pickers refetch after a membership change.
  invalidateAll(): void {
    this.#projectUsers = {};
  }

  upsert(user: User): void {
    this.users = this.users.some((u) => u.id === user.id)
      ? this.users.map((u) => (u.id === user.id ? user : u)).sort(byName)
      : [...this.users, user].sort(byName);
  }

  applyRealtime(data: unknown): User | null {
    if (typeof data !== 'object' || data === null) {
      return null;
    }
    const { id, name, avatar_url } = data as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string') {
      return null;
    }
    const user: User = {
      id,
      name,
      avatar_url: typeof avatar_url === 'string' ? avatar_url : null,
    };
    this.upsert(user);
    for (const [projectId, list] of Object.entries(this.#projectUsers)) {
      if (list.some((u) => u.id === user.id)) {
        this.#projectUsers[projectId] = list.map((u) => (u.id === user.id ? user : u)).sort(byName);
      }
    }
    return user;
  }

  loadWithRetry(onFirstError: () => void): () => void {
    let canceled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 2000;
    let errored = false;
    const attempt = (): void => {
      void this.load().catch(() => {
        if (canceled) {
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
      canceled = true;
      clearTimeout(timer);
    };
  }

  reset(): void {
    this.users = [];
    this.#projectUsers = {};
    this.#projectInflight.clear();
    this.#loaded = false;
  }

  async #fetch(): Promise<void> {
    const userId = session.user?.id;
    try {
      const data = assertOk(await api.GET('/api/users'));
      this.users = [...data.users].sort(byName);
      this.#loaded = true;
      if (userId !== undefined) {
        void saveUsersSnapshot(userId, this.users);
      }
    } catch (error) {
      // Names and avatars from the last visit beat blank placeholders on every
      // assignee on the board. A refused read still fails, so the caller's retry
      // and its error toast are unaffected.
      const cached =
        error instanceof ApiError || userId === undefined ? null : await readUsersSnapshot(userId);
      if (cached === null) {
        throw error;
      }
      this.users = cached;
      this.#loaded = true;
    }
  }

  async #fetchForProject(projectId: string): Promise<void> {
    const data = assertOk(
      await api.GET('/api/users', { params: { query: { project_id: projectId } } })
    );
    this.#projectUsers = { ...this.#projectUsers, [projectId]: [...data.users].sort(byName) };
  }
}

export const users = new UsersStore();
