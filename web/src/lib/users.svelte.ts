import { api, assertOk } from '../api/client';
import type { components } from '../api/api.generated';

export type User = components['schemas']['User'];

class UsersStore {
  users = $state<User[]>([]);
  #byId = $derived(new Map(this.users.map((user) => [user.id, user])));
  #loaded = false;
  #inflight: Promise<void> | null = null;

  byId(id: string): User | undefined {
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

  async refresh(): Promise<void> {
    await this.#fetch();
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
    this.#loaded = false;
  }

  async #fetch(): Promise<void> {
    const data = assertOk(await api.GET('/api/users'));
    this.users = [...data.users].sort((a, b) => a.name.localeCompare(b.name));
    this.#loaded = true;
  }
}

export const users = new UsersStore();
