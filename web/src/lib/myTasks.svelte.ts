import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';

export type MyTask = components['schemas']['MyTask'];
export type MyTaskPersonGroup = components['schemas']['MyTaskPersonGroup'];

class MyTasksStore {
  tasks = $state<MyTask[]>([]);
  waitingOnYou = $state<MyTaskPersonGroup[]>([]);
  youAreWaitingOn = $state<MyTaskPersonGroup[]>([]);
  loaded = $state(false);
  error = $state<string | null>(null);

  blocking = $derived(this.tasks.filter((task) => task.bucket === 'blocking'));
  ready = $derived(this.tasks.filter((task) => task.bucket === 'ready'));
  blocked = $derived(this.tasks.filter((task) => task.bucket === 'blocked'));

  // Monotonic token rather than an in-flight flag: a slow response must not
  // overwrite a newer one after a reset or a second visit.
  #fetchToken = 0;

  async load(): Promise<void> {
    // Cleared up front so a retry shows its loading state instead of re-rendering the
    // failure it is already trying to clear.
    this.error = null;
    const token = ++this.#fetchToken;
    try {
      const data = assertOk(await api.GET('/api/my-tasks'));
      if (token !== this.#fetchToken) {
        return;
      }
      this.tasks = data.tasks;
      this.waitingOnYou = data.waiting_on_you;
      this.youAreWaitingOn = data.you_are_waiting_on;
      this.loaded = true;
    } catch (error) {
      if (token !== this.#fetchToken) {
        return;
      }
      this.error = error instanceof ApiError ? error.message : 'Failed to load my tasks';
    }
  }

  reset(): void {
    this.#fetchToken++;
    this.tasks = [];
    this.waitingOnYou = [];
    this.youAreWaitingOn = [];
    this.loaded = false;
    this.error = null;
  }
}

export const myTasks = new MyTasksStore();
