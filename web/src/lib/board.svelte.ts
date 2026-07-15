// THROWAWAY STAND-IN — replaced at merge by the board branch implementation
import { api, assertOk } from '../api/client';
import type { BoardColumn, BoardLabel, BoardProject, BoardTask } from './board-types';

class BoardStore {
  project = $state<BoardProject | null>(null);
  columns = $state<BoardColumn[]>([]);
  tasks = $state<BoardTask[]>([]);
  labels = $state<BoardLabel[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  currentProjectId = $state<string | null>(null);

  async load(projectId: string): Promise<void> {
    if (this.currentProjectId === projectId && this.error === null) {
      return;
    }
    this.currentProjectId = projectId;
    await this.refetch();
  }

  async refetch(): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const data = assertOk(
        await api.GET('/api/projects/{id}', { params: { path: { id: projectId } } })
      );
      this.project = data.project;
      this.columns = [...data.columns].sort((a, b) => a.position - b.position);
      this.tasks = data.tasks;
      this.labels = data.labels;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to load project';
    } finally {
      this.loading = false;
    }
  }

  tasksInColumn(columnId: string): BoardTask[] {
    return this.tasks
      .filter((task) => task.column_id === columnId)
      .sort((a, b) => a.position - b.position);
  }
}

export const board = new BoardStore();
