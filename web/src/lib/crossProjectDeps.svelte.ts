import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';
import { taskRoute } from './task-route.svelte';

export type CrossProjectDependency = components['schemas']['CrossProjectDependency'];
export type CrossProjectDependencies = components['schemas']['CrossProjectDependenciesResponse'];

export interface CrossProjectEntry {
  // Null until the first response lands, and kept across a refresh: a reopened
  // panel paints its rows immediately rather than flashing skeletons at content
  // it already had.
  deps: CrossProjectDependencies | null;
  loading: boolean;
  error: boolean;
}

const EMPTY: CrossProjectDependencies = {
  blocked_by: [],
  blocking: [],
  hidden_blocked_by_count: 0,
  hidden_blocking_count: 0,
};

// Keyed and multi-target like task-route, not single-slot like taskActivity:
// the graph can hold several expansions open at once, and they have to survive
// a task panel opening and closing on top of them. Account-scoped for the same
// reason — every entry describes another project, so a project-scoped store
// would be the wrong lifetime.
class CrossProjectDependencyStore {
  #byTask = $state<Record<string, CrossProjectEntry>>({});
  #inflight = new Set<string>();
  #token = 0;
  #tokens = new Map<string, number>();

  // Side-effect free, so it is safe to read inside a $derived.
  get(taskId: string): CrossProjectEntry | undefined {
    return this.#byTask[taskId];
  }

  // Fetch unless it is cached or already running. Callers run it untracked.
  ensure(taskId: string): void {
    if (this.#inflight.has(taskId) || this.#byTask[taskId]?.deps != null) {
      return;
    }
    this.#fetch(taskId);
  }

  // Always refetches, keeping any cached rows on screen while it runs. A remote
  // task's title or done state changes on its own project's channel, which this
  // client is not subscribed to, so reopening a panel is the moment to revalidate.
  refresh(taskId: string): void {
    if (this.#inflight.has(taskId)) {
      return;
    }
    this.#fetch(taskId);
  }

  // Free to call from every mutation: it does nothing unless something is
  // already watching this task.
  invalidate(taskId: string): void {
    if (this.#byTask[taskId] === undefined) {
      return;
    }
    this.refresh(taskId);
  }

  forget(taskId: string): void {
    if (this.#byTask[taskId] === undefined) {
      return;
    }
    const remaining = { ...this.#byTask };
    delete remaining[taskId];
    this.#byTask = remaining;
    this.#tokens.delete(taskId);
  }

  reset(): void {
    this.#byTask = {};
    this.#inflight.clear();
    // Bumped so every response still in flight is stale on arrival.
    this.#token += 1;
    this.#tokens.clear();
  }

  #set(taskId: string, entry: CrossProjectEntry): void {
    this.#byTask = { ...this.#byTask, [taskId]: entry };
  }

  #fetch(taskId: string): void {
    // A single monotonic counter rather than comparing ids: an id cannot tell a
    // stale response from a fresh one across a t1 → t2 → t1 flip.
    const token = (this.#token += 1);
    this.#tokens.set(taskId, token);
    this.#inflight.add(taskId);
    this.#set(taskId, { deps: this.#byTask[taskId]?.deps ?? null, loading: true, error: false });

    void this.#load(taskId, token).finally(() => this.#inflight.delete(taskId));
  }

  async #load(taskId: string, token: number): Promise<void> {
    try {
      const deps = assertOk(
        await api.GET('/api/tasks/{id}/cross-project-dependencies', {
          params: { path: { id: taskId } },
        })
      );
      if (this.#tokens.get(taskId) !== token) return;
      // Authorized by the read that just named them, which is exactly what seed
      // is for: clicking one of these rows then resolves on the same tick.
      for (const edge of [...deps.blocked_by, ...deps.blocking]) {
        taskRoute.seed(edge.task_id, edge.project_id);
      }
      this.#set(taskId, { deps, loading: false, error: false });
    } catch (error) {
      if (this.#tokens.get(taskId) !== token) return;
      // A 404 is also what no-access returns, and the panel already says the
      // task is gone. Deliberately no toast: the task detail load fails beside
      // this one and a second message would only repeat it.
      const missing = error instanceof ApiError && error.status === 404;
      this.#set(taskId, {
        deps: missing ? EMPTY : (this.#byTask[taskId]?.deps ?? null),
        loading: false,
        error: !missing,
      });
    }
  }
}

export const crossProjectDeps = new CrossProjectDependencyStore();
