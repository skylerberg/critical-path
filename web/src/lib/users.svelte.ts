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
