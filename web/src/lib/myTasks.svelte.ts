import { api, assertOk } from '../api/client';
import { apiMessage } from './apiMessages';
import type { components } from '../api/api.generated';
import { projects } from './projects.svelte';
import { SvelteMap } from 'svelte/reactivity';

export type MyTask = components['schemas']['MyTask'];
export type MyTaskPersonGroup = components['schemas']['MyTaskPersonGroup'];

class MyTasksStore {
  tasks = $state<MyTask[]>([]);
  // Raw payloads; the public `waitingOnYou` / `youAreWaitingOn` derived views sort
  // each group's tasks to match the project list, so the raw arrays stay private.
  #waitingOnYou = $state<MyTaskPersonGroup[]>([]);
  #youAreWaitingOn = $state<MyTaskPersonGroup[]>([]);
  loaded = $state(false);
  error = $state<string | null>(null);

  // Ranks projects in the order they appear on the Projects page (active, then
  // archived) so My Tasks can read top-to-bottom the same way.
  #projectRank = $derived.by(() => {
    const rank = new SvelteMap<string, number>();
    let next = 0;
    for (const project of [...projects.active, ...projects.archived]) {
      rank.set(project.id, next++);
    }
    return rank;
  });

  // Stable sort by project rank: tasks in a project the store hasn't loaded yet
  // (or can't see) keep the server's relative order, after the known ones.
  #byProject<T extends { project_id: string }>(items: readonly T[]): T[] {
    const rank = this.#projectRank;
    return [...items].sort((a, b) => {
      const aRank = rank.get(a.project_id);
      const bRank = rank.get(b.project_id);
      if (aRank === undefined && bRank === undefined) return 0;
      if (aRank === undefined) return 1;
      if (bRank === undefined) return -1;
      return aRank - bRank;
    });
  }

  blocking = $derived(this.#byProject(this.tasks.filter((task) => task.bucket === 'blocking')));
  ready = $derived(this.#byProject(this.tasks.filter((task) => task.bucket === 'ready')));
  blocked = $derived(this.#byProject(this.tasks.filter((task) => task.bucket === 'blocked')));

  waitingOnYou = $derived(
    this.#waitingOnYou.map((group) => ({ ...group, tasks: this.#byProject(group.tasks) }))
  );
  youAreWaitingOn = $derived(
    this.#youAreWaitingOn.map((group) => ({ ...group, tasks: this.#byProject(group.tasks) }))
  );

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
      this.#waitingOnYou = data.waiting_on_you;
      this.#youAreWaitingOn = data.you_are_waiting_on;
      this.loaded = true;
    } catch (error) {
      if (token !== this.#fetchToken) {
        return;
      }
      this.error = apiMessage(error, 'Failed to load my tasks');
    }
  }

  reset(): void {
    this.#fetchToken++;
    this.tasks = [];
    this.#waitingOnYou = [];
    this.#youAreWaitingOn = [];
    this.loaded = false;
    this.error = null;
  }
}

export const myTasks = new MyTasksStore();
