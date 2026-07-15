import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';
import type { BoardColumn, BoardLabel, BoardProject, BoardTask } from './board-types';
import { newId } from './ids';
import type { RealtimeEvent } from './realtime-types';
import { append, positionForIndex } from './positions';
import { toasts } from './toasts.svelte';

export type TaskImage = components['schemas']['ImageResponse'];

export function positionAfterDrop(
  items: readonly { id: string; position: number }[],
  movedId: string
): number {
  const index = items.findIndex((item) => item.id === movedId);
  const others = items.filter((item) => item.id !== movedId).map((item) => item.position);
  return positionForIndex(others, index === -1 ? others.length : index);
}

class BoardStore {
  project = $state<BoardProject | null>(null);
  columns = $state<BoardColumn[]>([]);
  tasks = $state<BoardTask[]>([]);
  labels = $state<BoardLabel[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  currentProjectId = $state<string | null>(null);
  // Read-only signal for the shortcut layer; nothing in this store reacts to it.
  dragging = $state(false);
  filterLabelIds = $state<string[]>([]);
  filterAssigneeIds = $state<string[]>([]);

  // Monotonic tokens rather than project-id checks: ids cannot tell a stale
  // request apart from a fresh one across a P1->P2->P1 flip.
  #loadToken = 0;
  #fetchToken = 0;

  async load(projectId: string): Promise<void> {
    if (this.currentProjectId === projectId && this.error === null) {
      // Stale-while-revalidate: serve the cached board flicker-free.
      if (!this.loading) {
        void this.refetch();
      }
      return;
    }
    if (this.currentProjectId !== projectId) {
      this.reset();
    }
    this.currentProjectId = projectId;
    this.loading = true;
    const token = ++this.#loadToken;
    await this.refetch();
    if (token === this.#loadToken) {
      this.loading = false;
    }
  }

  async refetch(): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    const token = ++this.#fetchToken;
    try {
      const data = assertOk(
        await api.GET('/api/projects/{id}', { params: { path: { id: projectId } } })
      );
      if (token !== this.#fetchToken) {
        return;
      }
      this.project = data.project;
      this.columns = [...data.columns].sort((a, b) => a.position - b.position);
      this.tasks = data.tasks;
      this.labels = data.labels;
      this.error = null;
    } catch (error) {
      if (token !== this.#fetchToken) {
        return;
      }
      this.error = error instanceof ApiError ? error.message : 'Failed to load board';
    }
  }

  reset(): void {
    this.#loadToken += 1;
    this.#fetchToken += 1;
    this.project = null;
    this.columns = [];
    this.tasks = [];
    this.labels = [];
    this.taskImages = {};
    this.loading = false;
    this.error = null;
    this.dragging = false;
    this.currentProjectId = null;
    this.filterLabelIds = [];
    this.filterAssigneeIds = [];
  }

  tasksInColumn(columnId: string): BoardTask[] {
    return this.tasks
      .filter((task) => task.column_id === columnId)
      .sort((a, b) => a.position - b.position);
  }

  async createTask(columnId: string, title: string): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    const id = newId();
    const position = append(this.tasksInColumn(columnId).map((task) => task.position));
    const now = new Date().toISOString();
    this.tasks = [
      ...this.tasks,
      {
        id,
        column_id: columnId,
        title,
        description: null,
        position,
        created_at: now,
        updated_at: now,
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        image_count: 0,
      },
    ];
    try {
      assertOk(
        await api.POST('/api/tasks', {
          body: { id, project_id: projectId, column_id: columnId, title, position },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async moveTask(taskId: string, columnId: string, position: number): Promise<void> {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, column_id: columnId, position } : task
    );
    try {
      assertOk(
        await api.PATCH('/api/tasks/{id}', {
          params: { path: { id: taskId } },
          body: { column_id: columnId, position },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async updateTask(
    taskId: string,
    patch: { title?: string; description?: BoardTask['description'] }
  ): Promise<boolean> {
    this.tasks = this.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
    try {
      assertOk(
        await api.PATCH('/api/tasks/{id}', { params: { path: { id: taskId } }, body: patch })
      );
      return true;
    } catch (error) {
      await this.#mutationFailed(error);
      return false;
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    this.tasks = this.tasks
      .filter((task) => task.id !== taskId)
      .map((task) =>
        task.blocker_ids.includes(taskId)
          ? { ...task, blocker_ids: task.blocker_ids.filter((id) => id !== taskId) }
          : task
      );
    try {
      assertOk(await api.DELETE('/api/tasks/{id}', { params: { path: { id: taskId } } }));
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async createColumn(name: string): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    const id = newId();
    const position = append(this.columns.map((column) => column.position));
    this.columns = [...this.columns, { id, name, position, is_done: false }];
    try {
      assertOk(
        await api.POST('/api/columns', { body: { id, project_id: projectId, name, position } })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async renameColumn(columnId: string, name: string): Promise<void> {
    this.columns = this.columns.map((column) =>
      column.id === columnId ? { ...column, name } : column
    );
    try {
      assertOk(
        await api.PATCH('/api/columns/{id}', { params: { path: { id: columnId } }, body: { name } })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async moveColumn(columnId: string, position: number): Promise<void> {
    this.columns = this.columns
      .map((column) => (column.id === columnId ? { ...column, position } : column))
      .sort((a, b) => a.position - b.position);
    try {
      assertOk(
        await api.PATCH('/api/columns/{id}', {
          params: { path: { id: columnId } },
          body: { position },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async toggleColumnDone(columnId: string): Promise<void> {
    const column = this.columns.find((c) => c.id === columnId);
    if (column === undefined) {
      return;
    }
    const is_done = !column.is_done;
    this.columns = this.columns.map((c) => (c.id === columnId ? { ...c, is_done } : c));
    try {
      assertOk(
        await api.PATCH('/api/columns/{id}', {
          params: { path: { id: columnId } },
          body: { is_done },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async deleteColumn(columnId: string, moveTasksTo?: string): Promise<void> {
    const moved = this.tasksInColumn(columnId);
    this.columns = this.columns.filter((column) => column.id !== columnId);
    if (moveTasksTo !== undefined && moved.length > 0) {
      const targetPositions = this.tasksInColumn(moveTasksTo).map((task) => task.position);
      const base = targetPositions.length > 0 ? Math.max(...targetPositions) : 0;
      const movedPositions = new Map(
        moved.map((task, index) => [task.id, base + (index + 1) * 1000])
      );
      this.tasks = this.tasks.map((task) => {
        const newPosition = movedPositions.get(task.id);
        return newPosition === undefined
          ? task
          : { ...task, column_id: moveTasksTo, position: newPosition };
      });
    } else {
      this.tasks = this.tasks.filter((task) => task.column_id !== columnId);
    }
    try {
      const data = assertOk(
        await api.DELETE('/api/columns/{id}', {
          params: {
            path: { id: columnId },
            query: moveTasksTo === undefined ? undefined : { move_tasks_to: moveTasksTo },
          },
        })
      );
      if (data !== undefined) {
        const byId = new Map(data.moved_tasks.map((task) => [task.id, task]));
        this.tasks = this.tasks.map((task) => {
          const movedTask = byId.get(task.id);
          return movedTask === undefined
            ? task
            : { ...task, column_id: movedTask.column_id, position: movedTask.position };
        });
      }
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async createLabel(name: string, color: string): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    const id = newId();
    this.labels = [...this.labels, { id, name, color }];
    try {
      assertOk(await api.POST('/api/labels', { body: { id, project_id: projectId, name, color } }));
    } catch (error) {
      await this.#labelConflictOrFail(error);
    }
  }

  async updateLabel(labelId: string, patch: { name?: string; color?: string }): Promise<void> {
    this.labels = this.labels.map((label) =>
      label.id === labelId ? { ...label, ...patch } : label
    );
    try {
      assertOk(
        await api.PATCH('/api/labels/{id}', { params: { path: { id: labelId } }, body: patch })
      );
    } catch (error) {
      await this.#labelConflictOrFail(error);
    }
  }

  async deleteLabel(labelId: string): Promise<void> {
    this.labels = this.labels.filter((label) => label.id !== labelId);
    this.tasks = this.tasks.map((task) =>
      task.label_ids.includes(labelId)
        ? { ...task, label_ids: task.label_ids.filter((id) => id !== labelId) }
        : task
    );
    this.filterLabelIds = this.filterLabelIds.filter((id) => id !== labelId);
    try {
      assertOk(await api.DELETE('/api/labels/{id}', { params: { path: { id: labelId } } }));
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async setTaskLabels(taskId: string, labelIds: string[]): Promise<void> {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, label_ids: labelIds } : task
    );
    try {
      assertOk(
        await api.PUT('/api/tasks/{id}/labels', {
          params: { path: { id: taskId } },
          body: { label_ids: labelIds },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async setTaskAssignees(taskId: string, userIds: string[]): Promise<void> {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, assignee_ids: userIds } : task
    );
    try {
      assertOk(
        await api.PUT('/api/tasks/{id}/assignees', {
          params: { path: { id: taskId } },
          body: { user_ids: userIds },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async addBlocker(taskId: string, blockerTaskId: string): Promise<void> {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId && !task.blocker_ids.includes(blockerTaskId)
        ? { ...task, blocker_ids: [...task.blocker_ids, blockerTaskId] }
        : task
    );
    try {
      assertOk(
        await api.POST('/api/tasks/{id}/blockers', {
          params: { path: { id: taskId } },
          body: { blocker_task_id: blockerTaskId },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async removeBlocker(taskId: string, blockerTaskId: string): Promise<void> {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId
        ? { ...task, blocker_ids: task.blocker_ids.filter((id) => id !== blockerTaskId) }
        : task
    );
    try {
      assertOk(
        await api.DELETE('/api/tasks/{id}/blockers/{blockerTaskId}', {
          params: { path: { id: taskId, blockerTaskId } },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  toggleLabelFilter(labelId: string): void {
    this.filterLabelIds = this.filterLabelIds.includes(labelId)
      ? this.filterLabelIds.filter((id) => id !== labelId)
      : [...this.filterLabelIds, labelId];
  }

  toggleAssigneeFilter(userId: string): void {
    this.filterAssigneeIds = this.filterAssigneeIds.includes(userId)
      ? this.filterAssigneeIds.filter((id) => id !== userId)
      : [...this.filterAssigneeIds, userId];
  }

  clearFilters(): void {
    this.filterLabelIds = [];
    this.filterAssigneeIds = [];
  }

  get hasActiveFilters(): boolean {
    return this.filterLabelIds.length > 0 || this.filterAssigneeIds.length > 0;
  }

  taskMatchesFilters(task: BoardTask): boolean {
    const labelOk =
      this.filterLabelIds.length === 0 ||
      task.label_ids.some((id) => this.filterLabelIds.includes(id));
    const assigneeOk =
      this.filterAssigneeIds.length === 0 ||
      task.assignee_ids.some((id) => this.filterAssigneeIds.includes(id));
    return labelOk && assigneeOk;
  }

  taskImages = $state<Record<string, TaskImage[]>>({});

  async loadTaskImages(taskId: string): Promise<void> {
    try {
      const data = assertOk(await api.GET('/api/tasks/{id}', { params: { path: { id: taskId } } }));
      this.taskImages = { ...this.taskImages, [taskId]: data.images };
    } catch (error) {
      toasts.error(error instanceof ApiError ? error.message : 'Failed to load images');
    }
  }

  async uploadTaskImage(taskId: string, file: File): Promise<TaskImage | null> {
    try {
      const image = assertOk(
        await api.POST('/api/tasks/{id}/images', {
          params: { path: { id: taskId } },
          body: { file: file as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.append('file', file);
            return form;
          },
        })
      );
      this.taskImages = {
        ...this.taskImages,
        [taskId]: [...(this.taskImages[taskId] ?? []), image],
      };
      this.tasks = this.tasks.map((task) =>
        task.id === taskId ? { ...task, image_count: task.image_count + 1 } : task
      );
      return image;
    } catch (error) {
      toasts.error(error instanceof ApiError ? error.message : 'Image upload failed');
      return null;
    }
  }

  async deleteTaskImage(taskId: string, imageId: string): Promise<void> {
    this.taskImages = {
      ...this.taskImages,
      [taskId]: (this.taskImages[taskId] ?? []).filter((image) => image.id !== imageId),
    };
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, image_count: Math.max(0, task.image_count - 1) } : task
    );
    try {
      assertOk(await api.DELETE('/api/images/{id}', { params: { path: { id: imageId } } }));
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskImages(taskId);
    }
  }

  // Idempotent direct patches from realtime events; an echo of our own mutation
  // re-applies the same values and is a no-op.
  applyRealtime(event: RealtimeEvent): void {
    if (event.project_id !== this.currentProjectId) {
      return;
    }
    switch (event.type) {
      case 'task_created':
      case 'task_updated': {
        const task = event.data as BoardTask;
        this.tasks = this.tasks.some((t) => t.id === task.id)
          ? this.tasks.map((t) => (t.id === task.id ? task : t))
          : [...this.tasks, task];
        break;
      }
      case 'task_deleted': {
        const { id } = event.data as { id: string };
        this.tasks = this.tasks
          .filter((t) => t.id !== id)
          .map((t) =>
            t.blocker_ids.includes(id)
              ? { ...t, blocker_ids: t.blocker_ids.filter((b) => b !== id) }
              : t
          );
        break;
      }
      case 'task_relations_set': {
        const d = event.data as {
          task_id: string;
          label_ids: string[];
          assignee_ids: string[];
          blocker_ids: string[];
        };
        this.tasks = this.tasks.map((t) =>
          t.id === d.task_id
            ? {
                ...t,
                label_ids: d.label_ids,
                assignee_ids: d.assignee_ids,
                blocker_ids: d.blocker_ids,
              }
            : t
        );
        break;
      }
      case 'column_created':
      case 'column_updated': {
        const column = event.data as BoardColumn;
        this.columns = (
          this.columns.some((c) => c.id === column.id)
            ? this.columns.map((c) => (c.id === column.id ? column : c))
            : [...this.columns, column]
        ).sort((a, b) => a.position - b.position);
        break;
      }
      case 'column_deleted': {
        const d = event.data as {
          id: string;
          moved_tasks: { id: string; column_id: string; position: number }[];
        };
        this.columns = this.columns.filter((c) => c.id !== d.id);
        const moved = new Map(d.moved_tasks.map((m) => [m.id, m]));
        this.tasks = this.tasks
          .map((t) => {
            const m = moved.get(t.id);
            return m === undefined ? t : { ...t, column_id: m.column_id, position: m.position };
          })
          .filter((t) => t.column_id !== d.id);
        break;
      }
      case 'label_created':
      case 'label_updated': {
        const label = event.data as BoardLabel;
        this.labels = this.labels.some((l) => l.id === label.id)
          ? this.labels.map((l) => (l.id === label.id ? label : l))
          : [...this.labels, label];
        break;
      }
      case 'label_deleted': {
        const { id } = event.data as { id: string };
        this.labels = this.labels.filter((l) => l.id !== id);
        this.tasks = this.tasks.map((t) =>
          t.label_ids.includes(id) ? { ...t, label_ids: t.label_ids.filter((l) => l !== id) } : t
        );
        this.filterLabelIds = this.filterLabelIds.filter((l) => l !== id);
        break;
      }
      case 'image_created':
      case 'image_deleted': {
        const d = event.data as { task_id: string; image_count: number };
        this.tasks = this.tasks.map((t) =>
          t.id === d.task_id ? { ...t, image_count: d.image_count } : t
        );
        break;
      }
    }
  }

  async #mutationFailed(error: unknown): Promise<void> {
    toasts.error(error instanceof ApiError ? error.message : 'Something went wrong');
    await this.refetch();
  }

  // Duplicate-name 409s are rethrown after resync so callers can surface them inline.
  async #labelConflictOrFail(error: unknown): Promise<void> {
    if (error instanceof ApiError && error.status === 409) {
      await this.refetch();
      throw error;
    }
    await this.#mutationFailed(error);
  }
}

export const board = new BoardStore();
