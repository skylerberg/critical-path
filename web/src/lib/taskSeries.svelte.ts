import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';
import { toasts } from './toasts.svelte';

export type TaskSeries = components['schemas']['TaskSeries'];
export type CreateTaskSeriesBody = components['schemas']['CreateTaskSeries'];
export type PatchTaskSeriesBody = components['schemas']['PatchTaskSeries'];

class TaskSeriesStore {
  currentProjectId = $state<string | null>(null);
  list = $state<TaskSeries[]>([]);
  loaded = $state(false);
  loadError = $state<string | null>(null);

  // Bumped by every mutation and by reset as well as by the reads themselves, so
  // a response the server built before a write — or before a logout — cannot land
  // on top of what the store already knows.
  #listToken = 0;

  // Reports rather than throws: a client that reaches production ahead of the
  // API rollout must render an error, not break the board it is opened from.
  async load(projectId: string): Promise<void> {
    if (projectId !== this.currentProjectId) {
      this.#clear();
      this.currentProjectId = projectId;
    }
    const token = ++this.#listToken;
    this.loadError = null;
    try {
      const data = assertOk(
        await api.GET('/api/task-series', { params: { query: { project_id: projectId } } })
      );
      if (token !== this.#listToken) return;
      this.list = data.series;
      this.loaded = true;
    } catch (error) {
      if (token !== this.#listToken) return;
      this.loadError = error instanceof ApiError ? error.message : 'Failed to load recurring cards';
    }
  }

  reset(): void {
    this.#clear();
    this.currentProjectId = null;
  }

  // Not optimistic, and deliberately so: the rule summary, the resolved preset
  // and the next occurrence are all server-derived, so a local row would paint
  // blanks. The rejection is rethrown for the form to show inline.
  async create(body: CreateTaskSeriesBody): Promise<TaskSeries> {
    this.#listToken += 1;
    const row = assertOk(await api.POST('/api/task-series', { body }));
    this.list = [...this.list, row];
    return row;
  }

  async patch(id: string, body: PatchTaskSeriesBody): Promise<TaskSeries> {
    this.#listToken += 1;
    const row = assertOk(
      await api.PATCH('/api/task-series/{id}', { params: { path: { id } }, body })
    );
    this.#replace(id, row);
    return row;
  }

  async setPaused(id: string, paused: boolean): Promise<void> {
    this.#listToken += 1;
    this.#update(id, (series) => ({ ...series, status: paused ? 'paused' : 'active' }));
    try {
      const row = assertOk(
        await api.PATCH('/api/task-series/{id}', {
          params: { path: { id } },
          body: { status: paused ? 'paused' : 'active' },
        })
      );
      this.#replace(id, row);
    } catch (error) {
      await this.#mutationFailed(
        error,
        paused ? 'Failed to pause the series' : 'Failed to resume the series'
      );
    }
  }

  async clearMissed(id: string): Promise<void> {
    this.#listToken += 1;
    this.#update(id, (series) => ({
      ...series,
      missed_occurrence_count: 0,
      last_missed_date: null,
    }));
    try {
      const row = assertOk(
        await api.PATCH('/api/task-series/{id}', {
          params: { path: { id } },
          body: { clear_missed: true },
        })
      );
      this.#replace(id, row);
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to dismiss the missed occurrences');
    }
  }

  async remove(id: string): Promise<void> {
    this.#listToken += 1;
    this.list = this.list.filter((series) => series.id !== id);
    try {
      assertOk(await api.DELETE('/api/task-series/{id}', { params: { path: { id } } }));
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to delete the series');
    }
  }

  #update(id: string, patch: (series: TaskSeries) => TaskSeries): void {
    this.list = this.list.map((series) => (series.id === id ? patch(series) : series));
  }

  #replace(id: string, row: TaskSeries): void {
    this.#update(id, () => row);
  }

  async #mutationFailed(error: unknown, fallback: string): Promise<void> {
    toasts.error(error instanceof ApiError ? error.message : fallback);
    if (this.currentProjectId !== null) {
      await this.load(this.currentProjectId);
    }
  }

  #clear(): void {
    this.#listToken += 1;
    this.list = [];
    this.loaded = false;
    this.loadError = null;
  }
}

export const taskSeries = new TaskSeriesStore();
