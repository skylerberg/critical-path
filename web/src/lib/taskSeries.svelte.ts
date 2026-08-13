import { api, assertOk } from '../api/client';
import { apiMessage } from './apiMessages';
import { mutationFailed } from './store-sync';
import type { components } from '../api/api.generated';
import type { RealtimeEvent } from './realtime-types';

export type TaskSeries = components['schemas']['TaskSeries'];
export type CreateTaskSeriesBody = components['schemas']['CreateTaskSeries'];
export type CreateSeriesFromTaskBody = components['schemas']['CreateSeriesFromTask'];
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
      this.loadError = apiMessage(error, 'Failed to load recurring cards');
    }
  }

  reset(): void {
    this.#clear();
    this.currentProjectId = null;
  }

  applyRealtime(event: RealtimeEvent): void {
    // Before the first list lands there is nothing to merge into, and building
    // one from events alone would paint a list holding only what has changed.
    if (!this.loaded || event.project_id !== this.currentProjectId) {
      return;
    }
    switch (event.type) {
      case 'series_created': {
        const row = event.data;
        // The echo of our own create arrives after we appended it.
        this.list = this.list.some((series) => series.id === row.id)
          ? this.list.map((series) => (series.id === row.id ? row : series))
          : [...this.list, row];
        break;
      }
      case 'series_updated': {
        // Update-only: a row we no longer hold is one we have already deleted,
        // and an edit still in flight when that happened must not resurrect it.
        const row = event.data;
        this.#replace(row.id, row);
        break;
      }
      case 'series_deleted': {
        const { id } = event.data;
        this.list = this.list.filter((series) => series.id !== id);
        break;
      }
    }
  }

  resync(): void {
    if (this.currentProjectId !== null) {
      void this.load(this.currentProjectId);
    }
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

  // The card is adopted as the series' first occurrence, so the row lands here
  // and the caller is handed it to name the recurrence on the card without a
  // second read. Rejection is rethrown for the panel to show inline.
  async createFromTask(taskId: string, body: CreateSeriesFromTaskBody): Promise<TaskSeries> {
    this.#listToken += 1;
    const row = assertOk(
      await api.POST('/api/tasks/{id}/series', { params: { path: { id: taskId } }, body })
    );
    // Only into a list this project already loaded: appending to a list still
    // holding another project's series is how a row shows up under the wrong
    // board, and the load this project has yet to do will fetch it anyway.
    if (this.loaded && row.project_id === this.currentProjectId) {
      this.list = [...this.list, row];
    }
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
      await mutationFailed(
        this,
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
      await mutationFailed(this, error, 'Failed to dismiss the missed occurrences');
    }
  }

  // Reports whether the series is actually gone rather than throwing, because
  // the failure path here is a toast and a resync. A caller holding its own copy
  // of the row — a card naming the recurrence it came from — has no other way to
  // tell a delete that landed from one that was put back.
  async remove(id: string): Promise<boolean> {
    this.#listToken += 1;
    this.list = this.list.filter((series) => series.id !== id);
    try {
      assertOk(await api.DELETE('/api/task-series/{id}', { params: { path: { id } } }));
      return true;
    } catch (error) {
      await mutationFailed(this, error, 'Failed to delete the series');
      return false;
    }
  }

  #update(id: string, patch: (series: TaskSeries) => TaskSeries): void {
    this.list = this.list.map((series) => (series.id === id ? patch(series) : series));
  }

  #replace(id: string, row: TaskSeries): void {
    this.#update(id, () => row);
  }

  #clear(): void {
    this.#listToken += 1;
    this.list = [];
    this.loaded = false;
    this.loadError = null;
  }
}

export const taskSeries = new TaskSeriesStore();
