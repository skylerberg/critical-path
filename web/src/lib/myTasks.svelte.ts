import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';

export type MyTask = components['schemas']['MyTask'];
export type MyTaskLink = components['schemas']['MyTaskLink'];
export type MyTaskPersonGroup = components['schemas']['MyTaskPersonGroup'];

class MyTasksStore {
  tasks = $state<MyTask[]>([]);
  waitingOnYou = $state<MyTaskPersonGroup[]>([]);
  youAreWaitingOn = $state<MyTaskPersonGroup[]>([]);
  loaded = $state(false);
  loading = $state(false);
  error = $state<string | null>(null);

  blocking = $derived(this.tasks.filter((task) => task.bucket === 'blocking'));
  ready = $derived(this.tasks.filter((task) => task.bucket === 'ready'));
  blocked = $derived(this.tasks.filter((task) => task.bucket === 'blocked'));

  // Monotonic token rather than an in-flight flag: a slow response must not
  // overwrite a newer one after a reset or a second visit.
  #fetchToken = 0;

  async load(): Promise<void> {
    if (!this.loaded) {
      this.loading = true;
    }
    const token = ++this.#fetchToken;
    try {
      const data = assertOk(await api.GET('/api/my-tasks'));
      if (token !== this.#fetchToken) {
        return;
      }
      this.tasks = data.tasks;
      this.waitingOnYou = data.waiting_on_you;
      this.youAreWaitingOn = data.you_are_waiting_on;
      this.error = null;
      this.loaded = true;
    } catch (error) {
      if (token !== this.#fetchToken) {
        return;
      }
      this.error = error instanceof ApiError ? error.message : 'Failed to load my tasks';
    } finally {
      if (token === this.#fetchToken) {
        this.loading = false;
      }
    }
  }

  reset(): void {
    this.#fetchToken++;
    this.tasks = [];
    this.waitingOnYou = [];
    this.youAreWaitingOn = [];
    this.loaded = false;
    this.loading = false;
    this.error = null;
  }
}

export const myTasks = new MyTasksStore();
