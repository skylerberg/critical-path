import { api, assertOk } from '../api/client';
import type { components } from '../api/api.generated';

export type User = components['schemas']['User'];

function byName(a: User, b: User): number {
  return a.name.localeCompare(b.name);
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

  byId(id: string): User | undefined {
    return this.#byId.get(id);
  }

  // A user who is no longer visible (e.g. an assignee who lost project access)
  // still needs to render, so callers get a neutral placeholder instead of undefined.
  displayFor(id: string): User {
    return this.#byId.get(id) ?? { id, name: '', email: '', avatar_url: null };
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

  // Drop the project-scoped cache so pickers refetch after a membership change.
  invalidateAll(): void {
    this.#projectUsers = {};
  }

  upsert(user: User): void {
    this.users = this.users.some((u) => u.id === user.id)
      ? this.users.map((u) => (u.id === user.id ? user : u))
      : [...this.users, user].sort(byName);
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
    this.users = [];
    this.#projectUsers = {};
    this.#projectInflight.clear();
    this.#loaded = false;
  }

  async #fetch(): Promise<void> {
    const data = assertOk(await api.GET('/api/users'));
    this.users = [...data.users].sort(byName);
    this.#loaded = true;
  }

  async #fetchForProject(projectId: string): Promise<void> {
    const data = assertOk(
      await api.GET('/api/users', { params: { query: { project_id: projectId } } })
    );
    this.#projectUsers = { ...this.#projectUsers, [projectId]: [...data.users].sort(byName) };
  }
}

export const users = new UsersStore();
