import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';

export type TaskActivityEntry = components['schemas']['TaskActivity'];

// A burst of edits (the description autosave and its own realtime echo) would
// otherwise download the whole log several times a second.
const REFRESH_INTERVAL_MS = 1000;

class TaskActivityStore {
  entries = $state<TaskActivityEntry[]>([]);
  loading = $state(false);
  error = $state(false);

  #taskId: string | null = null;
  // Monotonic token rather than an id check: ids cannot tell a stale response
  // apart from a fresh one across a t1 -> t2 -> t1 flip.
  #token = 0;
  #lastFetchAt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;

  async load(taskId: string): Promise<void> {
    if (taskId !== this.#taskId) {
      this.#clearTimer();
      this.#taskId = taskId;
      this.entries = [];
      this.error = false;
      this.loading = true;
    }
    await this.#fetch(taskId);
  }

  // Free to call from every mutation: only the open task refetches, and a burst
  // collapses into one trailing fetch.
  invalidate(taskId: string): void {
    if (taskId !== this.#taskId) {
      return;
    }
    const elapsed = Date.now() - this.#lastFetchAt;
    if (elapsed >= REFRESH_INTERVAL_MS) {
      void this.#fetch(taskId);
      return;
    }
    if (this.#timer !== null) {
      return;
    }
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#taskId === taskId) {
        void this.#fetch(taskId);
      }
    }, REFRESH_INTERVAL_MS - elapsed);
  }

  reset(): void {
    this.#token += 1;
    this.#clearTimer();
    this.#taskId = null;
    this.entries = [];
    this.loading = false;
    this.error = false;
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async #fetch(taskId: string): Promise<void> {
    const token = ++this.#token;
    this.#lastFetchAt = Date.now();
    try {
      const data = assertOk(
        await api.GET('/api/tasks/{id}/activity', { params: { path: { id: taskId } } })
      );
      if (token !== this.#token) {
        return;
      }
      this.entries = data.activity;
      this.error = false;
    } catch (error) {
      if (token !== this.#token) {
        return;
      }
      // A deleted task has no log to show, and neither does an API that predates
      // one; both are an empty list rather than a failure worth reporting. Any
      // other failure keeps the entries, since this also runs as a refresh.
      const gone = error instanceof ApiError && error.status === 404;
      this.error = !gone;
      if (gone) {
        this.entries = [];
      }
    } finally {
      if (token === this.#token) {
        this.loading = false;
      }
    }
  }
}

export const taskActivity = new TaskActivityStore();
