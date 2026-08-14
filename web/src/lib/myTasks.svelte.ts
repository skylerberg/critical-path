import { SvelteMap } from 'svelte/reactivity';
import { api, assertOk } from '../api/client';
import { apiMessage } from './apiMessages';
import { mergePersonGroups, mergeTaskPages } from './myTaskGroups';
import type { components } from '../api/api.generated';
import { projects } from './projects.svelte';

export type MyTask = components['schemas']['MyTask'];
export type MyTaskLink = components['schemas']['MyTaskLink'];
export type MyTaskPersonGroup = components['schemas']['MyTaskPersonGroup'];

class MyTasksStore {
  tasks = $state<MyTask[]>([]);
  // Raw payloads; the public `waitingOnYou` / `youAreWaitingOn` derived views sort
  // each group's tasks to match the project list, so the raw arrays stay private.
  #waitingOnYou = $state<MyTaskPersonGroup[]>([]);
  #youAreWaitingOn = $state<MyTaskPersonGroup[]>([]);
  loaded = $state(false);
  error = $state<string | null>(null);
  // The server caps a response at a page most people never fill, so this is
  // null for almost every caller and the screen shows nothing about paging.
  #nextOffset = $state<number | null>(null);
  loadingMore = $state(false);
  hasMore = $derived(this.#nextOffset !== null);
  // Sticky once a page has been pulled in, so the count line survives the last
  // one. Without it the live region unmounts at the moment the final page
  // lands, and the reader who pressed the button hears nothing at all.
  loadedMore = $state(false);

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
      // Coalesced because deploys are rolling: an API pod from the previous
      // release answers without the field at all, and `undefined !== null`
      // would offer a Load more button that fetches the same page forever.
      this.#nextOffset = data.next_offset ?? null;
      this.loadedMore = false;
      this.loaded = true;
    } catch (error) {
      if (token !== this.#fetchToken) {
        return;
      }
      this.error = apiMessage(error, 'Failed to load my tasks');
    }
  }

  // Deliberately does not take a new fetch token: this extends the load that is
  // already on screen rather than replacing it, so it reads the current token
  // and abandons its result if a reload or a reset has moved on since.
  async loadMore(): Promise<void> {
    const offset = this.#nextOffset;
    if (offset === null || this.loadingMore) {
      return;
    }
    this.error = null;
    this.loadingMore = true;
    const token = this.#fetchToken;
    try {
      const data = assertOk(
        // A query parameter is a string on the wire, which is what the spec
        // declares and the generated client asks for.
        await api.GET('/api/my-tasks', { params: { query: { offset: String(offset) } } })
      );
      if (token !== this.#fetchToken) {
        return;
      }
      // Merged rather than appended, for the same reason the person groups are.
      this.tasks = mergeTaskPages(this.tasks, data.tasks);
      this.#waitingOnYou = mergePersonGroups(this.#waitingOnYou, data.waiting_on_you);
      this.#youAreWaitingOn = mergePersonGroups(this.#youAreWaitingOn, data.you_are_waiting_on);
      this.#nextOffset = data.next_offset ?? null;
      this.loadedMore = true;
    } catch (error) {
      if (token !== this.#fetchToken) {
        return;
      }
      this.error = apiMessage(error, 'Failed to load more tasks');
    } finally {
      this.loadingMore = false;
    }
  }

  reset(): void {
    this.#fetchToken++;
    this.tasks = [];
    this.#waitingOnYou = [];
    this.#youAreWaitingOn = [];
    this.#nextOffset = null;
    this.loadingMore = false;
    this.loadedMore = false;
    this.loaded = false;
    this.error = null;
  }
}

export const myTasks = new MyTasksStore();
