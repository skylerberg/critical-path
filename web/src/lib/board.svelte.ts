import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';
import { filtersToSearch, mergeFilterSearch, noFilters, type BoardFilters } from './board-filters';
import type {
  ArchivedTask,
  BoardColumn,
  BoardLabel,
  BoardProject,
  BoardTask,
  CycleTask,
  PublicBoardPayload,
} from './board-types';
import { buildGraph, cycleNodeIds, cyclePathIds } from './graph';
import { newId } from './ids';
import type { RealtimeEvent } from './realtime-types';
import { append, between, prepend } from './positions';
import { router, splitPath } from './router.svelte';
import { session } from './session.svelte';
import { taskActivity } from './taskActivity.svelte';
import { toasts } from './toasts.svelte';
import { users, type User } from './users.svelte';

export type TaskImage = components['schemas']['ImageResponse'];
export type TaskComment = components['schemas']['Comment'];
export type CommentBody = TaskComment['body'];

export type TaskUpdateOutcome =
  | { status: 'ok'; updated_at: string }
  | { status: 'conflict' }
  | { status: 'error' };

// Anchors on the visual neighbor above the drop, so it stays correct when the
// display order is a filtered partition rather than pure position order.
export function positionAfterDrop(
  items: readonly { id: string; position: number }[],
  movedId: string
): number {
  const index = items.findIndex((item) => item.id === movedId);
  const others = items.filter((item) => item.id !== movedId).map((item) => item.position);
  if (index === -1) {
    return append(others);
  }
  if (index === 0) {
    return prepend(others);
  }
  const prev = items[index - 1]!.position;
  let next: number | null = null;
  for (const position of others) {
    if (position > prev && (next === null || position < next)) {
      next = position;
    }
  }
  return next === null ? append(others) : between(prev, next);
}

const CYCLE_PATH_MS = 5000;
const MAX_CYCLE_TITLES = 6;
const MAX_CYCLE_TITLE_CHARS = 40;

function truncateTitle(title: string): string {
  return title.length > MAX_CYCLE_TITLE_CHARS ? `${title.slice(0, MAX_CYCLE_TITLE_CHARS)}…` : title;
}

// Elision keeps the repeated last entry so the message still reads as a loop.
function cycleMessage(prefix: string, titles: readonly string[]): string {
  if (titles.length === 0) {
    return prefix;
  }
  const shown = titles.map(truncateTitle);
  const parts =
    shown.length <= MAX_CYCLE_TITLES
      ? shown
      : [...shown.slice(0, MAX_CYCLE_TITLES - 2), '…', shown[shown.length - 1]!];
  return `${prefix}: ${parts.join(' → ')}`;
}

// Null unless the server sent a well-formed path, so a pod that predates the
// `cycle` key still falls back to the plain message.
function cycleFromApiError(error: unknown): { message: string; cycle: CycleTask[] } | null {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return null;
  }
  const cycle = (error.body as { cycle?: unknown } | null | undefined)?.cycle;
  if (!Array.isArray(cycle) || cycle.length === 0) {
    return null;
  }
  const steps = cycle.filter(
    (step): step is CycleTask =>
      typeof step === 'object' &&
      step !== null &&
      typeof (step as { id?: unknown }).id === 'string' &&
      typeof (step as { title?: unknown }).title === 'string'
  );
  return steps.length === cycle.length ? { message: error.message, cycle: steps } : null;
}

function chronological(a: TaskComment, b: TaskComment): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

class BoardStore {
  project = $state<BoardProject | null>(null);
  columns = $state<BoardColumn[]>([]);
  tasks = $state<BoardTask[]>([]);
  labels = $state<BoardLabel[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  errorStatus = $state<number | null>(null);
  currentProjectId = $state<string | null>(null);
  readonly = $state(false);
  // Read-only signal for the shortcut layer; nothing in this store reacts to it.
  dragging = $state(false);
  filterLabelIds = $state<string[]>([]);
  filterAssigneeIds = $state<string[]>([]);
  filterQuery = $state('');
  // In the store rather than the view so it survives switching views and back.
  graphShowDone = $state(false);
  cyclePath = $state<CycleTask[] | null>(null);
  archivedTasks = $state<ArchivedTask[]>([]);
  archivedLoading = $state(false);
  archivedLoaded = $state(false);
  archivedError = $state<string | null>(null);

  // Monotonic tokens rather than project-id checks: ids cannot tell a stale
  // request apart from a fresh one across a P1->P2->P1 flip.
  #loadToken = 0;
  #fetchToken = 0;
  #archivedToken = 0;
  #cyclePathTimer: ReturnType<typeof setTimeout> | null = null;

  // Filters are adopted before the first await, so a link built from the store during
  // the fetch already carries the incoming project's narrowing.
  async load(
    projectId: string,
    filters: BoardFilters = noFilters(),
    opts: { readonly?: boolean } = {}
  ): Promise<void> {
    const wantsReadonly = opts.readonly ?? false;
    const sameProject = this.currentProjectId === projectId && this.readonly === wantsReadonly;
    if (!sameProject) {
      this.reset();
    }
    this.currentProjectId = projectId;
    this.readonly = wantsReadonly;
    this.setFilters(filters);
    if (sameProject && this.error === null) {
      // Stale-while-revalidate: serve the cached board flicker-free.
      if (!this.loading) {
        void this.refetch();
      }
      return;
    }
    this.loading = true;
    const token = ++this.#loadToken;
    await this.refetch();
    if (token === this.#loadToken) {
      this.loading = false;
    }
  }

  // `quiet` suppresses the error page for reads that merely supplement an action
  // that already succeeded.
  async refetch({ quiet = false }: { quiet?: boolean } = {}): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    const token = ++this.#fetchToken;
    try {
      const { data, projectUsers } = this.readonly
        ? await this.#fetchPublic(projectId)
        : {
            data: assertOk(
              await api.GET('/api/projects/{id}', { params: { path: { id: projectId } } })
            ),
            projectUsers: null,
          };
      if (token !== this.#fetchToken) {
        return;
      }
      // Behind the staleness check: a losing response must not refill the user
      // cache the read-only page dropped on its way out.
      if (projectUsers !== null) {
        users.setForProject(projectId, projectUsers);
      }
      this.project = data.project;
      this.columns = [...data.columns].sort((a, b) => a.position - b.position);
      this.tasks = data.tasks;
      this.labels = data.labels;
      this.error = null;
      this.errorStatus = null;
      // Now that the label set is known, drop any the incoming URL named but this
      // project does not have.
      this.setFilters(this.filters);
    } catch (error) {
      if (token !== this.#fetchToken || quiet) {
        return;
      }
      this.error = error instanceof ApiError ? error.message : 'Failed to load board';
      this.errorStatus = error instanceof ApiError ? error.status : null;
    }
  }

  async loadArchived(): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    const token = ++this.#archivedToken;
    this.archivedLoading = true;
    // Cleared up front so a retry shows its loading state instead of re-rendering
    // the failure it is already retrying.
    this.archivedError = null;
    try {
      const data = assertOk(
        await api.GET('/api/projects/{id}/archived-tasks', { params: { path: { id: projectId } } })
      );
      if (token !== this.#archivedToken) {
        return;
      }
      this.archivedTasks = data.tasks;
      this.archivedLoaded = true;
      this.archivedError = null;
    } catch (error) {
      if (token !== this.#archivedToken) {
        return;
      }
      this.archivedError = error instanceof ApiError ? error.message : 'Failed to load the archive';
    } finally {
      if (token === this.#archivedToken) {
        this.archivedLoading = false;
      }
    }
  }

  // A client that never opened the archive pays nothing for the resync.
  async refetchArchived(): Promise<void> {
    if (!this.archivedLoaded) {
      return;
    }
    await this.loadArchived();
  }

  // refetch() can only repair the board, so every "reload everything" backstop
  // has to come through here instead.
  async resync(): Promise<void> {
    await this.refetch();
    await this.refetchArchived();
  }

  // Placeholders stand in for the identity and timestamp fields the public
  // payload withholds; nothing the read-only UI renders reads them.
  async #fetchPublic(projectId: string): Promise<{
    data: {
      project: BoardProject;
      columns: BoardColumn[];
      tasks: BoardTask[];
      labels: BoardLabel[];
    };
    projectUsers: User[];
  }> {
    const data: PublicBoardPayload = assertOk(
      await api.GET('/api/public/projects/{id}/board', { params: { path: { id: projectId } } })
    );
    return {
      data: {
        project: {
          ...data.project,
          archived_at: null,
          created_at: '',
          created_by: null,
          member_ids: [],
          is_public: true,
        },
        columns: data.columns,
        tasks: data.tasks.map((task) => ({
          ...task,
          created_at: '',
          updated_at: '',
          comment_count: 0,
        })),
        labels: data.labels,
      },
      projectUsers: data.users.map((user) => ({ ...user, email: '' })),
    };
  }

  reset(): void {
    this.#loadToken += 1;
    this.#fetchToken += 1;
    this.#archivedToken += 1;
    this.project = null;
    this.columns = [];
    this.tasks = [];
    this.labels = [];
    this.archivedTasks = [];
    this.archivedLoading = false;
    this.archivedLoaded = false;
    this.archivedError = null;
    this.taskImages = {};
    this.taskComments = {};
    this.loading = false;
    this.error = null;
    this.errorStatus = null;
    this.dragging = false;
    this.currentProjectId = null;
    this.readonly = false;
    this.filterLabelIds = [];
    this.filterAssigneeIds = [];
    this.filterQuery = '';
    this.graphShowDone = false;
    this.#clearCyclePath();
  }

  #clearCyclePath(): void {
    if (this.#cyclePathTimer !== null) {
      clearTimeout(this.#cyclePathTimer);
      this.#cyclePathTimer = null;
    }
    this.cyclePath = null;
  }

  // Expires alongside the toast that explains it, so the highlight never
  // outlives its own caption.
  #showCyclePath(path: CycleTask[]): void {
    this.#clearCyclePath();
    this.cyclePath = path;
    this.#cyclePathTimer = setTimeout(() => this.#clearCyclePath(), CYCLE_PATH_MS);
  }

  tasksInColumn(columnId: string): BoardTask[] {
    return this.tasks
      .filter((task) => task.column_id === columnId)
      .sort((a, b) => a.position - b.position);
  }

  async createTask(columnId: string, title: string): Promise<string | null> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return null;
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
        comment_count: 0,
      },
    ];
    try {
      const created = assertOk(
        await api.POST('/api/tasks', {
          body: { id, project_id: projectId, column_id: columnId, title, position },
        })
      );
      this.#adoptTimestamps(id, {
        created_at: created.created_at,
        updated_at: created.updated_at,
      });
      return id;
    } catch (error) {
      await this.#mutationFailed(error);
      return null;
    }
  }

  // Awaiting the create before addBlocker guarantees the row exists server-side, so
  // the blocker call can never race ahead of it (the label-race class of bug).
  // addBlocker(taskId, blockerTaskId) reads as "blockerTaskId blocks taskId", hence
  // the inverted argument order for each direction below.
  async createAndLinkTask(
    title: string,
    opts: { blockerOf?: string; blockedBy?: string } = {}
  ): Promise<string | null> {
    // A done column can sit first, and dropping a brand-new task straight into it
    // would file it as finished — and hide it from the graph that just made it.
    const column = this.columns.find((c) => !c.is_done) ?? this.columns[0];
    if (column === undefined) {
      return null;
    }
    const id = await this.createTask(column.id, title);
    if (id === null) {
      return null;
    }
    if (opts.blockerOf !== undefined) {
      await this.addBlocker(opts.blockerOf, id);
    } else if (opts.blockedBy !== undefined) {
      await this.addBlocker(id, opts.blockedBy);
    }
    return id;
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
    } finally {
      // In `finally`, not on success: a failed move resyncs the board, and the log
      // has to end up showing what the server kept.
      taskActivity.invalidate(taskId);
    }
  }

  // Merges only the timestamps, never the whole response body: a label or assignee
  // change applied optimistically while the write was in flight must survive.
  #adoptTimestamps(taskId: string, times: { created_at?: string; updated_at: string }): void {
    this.tasks = this.tasks.map((task) => (task.id === taskId ? { ...task, ...times } : task));
  }

  async updateTask(
    taskId: string,
    patch: { title?: string; description?: BoardTask['description'] },
    expectedUpdatedAt?: string
  ): Promise<TaskUpdateOutcome> {
    this.tasks = this.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
    try {
      const data = assertOk(
        await api.PATCH('/api/tasks/{id}', {
          params: { path: { id: taskId } },
          body: {
            ...patch,
            ...(expectedUpdatedAt !== undefined ? { expected_updated_at: expectedUpdatedAt } : {}),
          },
        })
      );
      this.#adoptTimestamps(taskId, { updated_at: data.updated_at });
      return { status: 'ok', updated_at: data.updated_at };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // No toast: the caller owns the conflict surface, and the refetch is what
        // lets it offer the server's current version.
        await this.refetch();
        return { status: 'conflict' };
      }
      await this.#mutationFailed(error);
      return { status: 'error' };
    } finally {
      taskActivity.invalidate(taskId);
    }
  }

  // Plural so emptying a column is one pass over the tasks, not one per card.
  #dropTasks(taskIds: readonly string[]): void {
    const dropped = new Set(taskIds);
    this.tasks = this.tasks
      .filter((task) => !dropped.has(task.id))
      .map((task) =>
        task.blocker_ids.some((id) => dropped.has(id))
          ? { ...task, blocker_ids: task.blocker_ids.filter((id) => !dropped.has(id)) }
          : task
      );
  }

  // A local archive edit outranks any load already in flight: that response was
  // built before the edit and would put the row back.
  #discardArchivedLoad(): void {
    this.#archivedToken += 1;
    this.archivedLoading = false;
  }

  async deleteTask(taskId: string): Promise<void> {
    this.#dropTasks([taskId]);
    this.#discardArchivedLoad();
    this.archivedTasks = this.archivedTasks.filter((task) => task.id !== taskId);
    try {
      assertOk(await api.DELETE('/api/tasks/{id}', { params: { path: { id: taskId } } }));
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async archiveTask(taskId: string): Promise<void> {
    // Captured before the drop: nothing else holds the row afterwards.
    const task = this.tasks.find((t) => t.id === taskId);
    if (task === undefined) {
      return;
    }
    this.#dropTasks([taskId]);
    this.#discardArchivedLoad();
    this.archivedTasks = [
      { ...task, archived_at: new Date().toISOString() },
      ...this.archivedTasks,
    ];
    try {
      const archived = assertOk(
        await api.POST('/api/tasks/{id}/archive', { params: { path: { id: taskId } } })
      );
      this.archivedTasks = this.archivedTasks.map((t) => (t.id === taskId ? archived : t));
    } catch (error) {
      this.archivedTasks = this.archivedTasks.filter((t) => t.id !== taskId);
      await this.#mutationFailed(error);
    } finally {
      taskActivity.invalidate(taskId);
    }
  }

  async restoreTask(taskId: string): Promise<void> {
    this.#discardArchivedLoad();
    this.archivedTasks = this.archivedTasks.filter((t) => t.id !== taskId);
    try {
      const restored = assertOk(
        await api.POST('/api/tasks/{id}/restore', { params: { path: { id: taskId } } })
      );
      this.tasks = this.tasks.some((t) => t.id === restored.id)
        ? this.tasks.map((t) => (t.id === restored.id ? restored : t))
        : [...this.tasks, restored];
      // The tasks this one blocks are not derivable from the response, and only
      // a board read names that direction.
      await this.refetch({ quiet: true });
    } catch (error) {
      await this.#mutationFailed(error);
    } finally {
      taskActivity.invalidate(taskId);
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

  // The server relocates every row in the column, archived ones included, so
  // leaving them behind would strand them on a column id the board no longer has.
  async deleteColumn(columnId: string, moveTasksTo?: string): Promise<void> {
    const movedLive = this.tasksInColumn(columnId);
    const movedArchived = this.archivedTasks.filter((task) => task.column_id === columnId);
    this.columns = this.columns.filter((column) => column.id !== columnId);
    if (moveTasksTo !== undefined && movedLive.length + movedArchived.length > 0) {
      const targetPositions = this.tasksInColumn(moveTasksTo).map((task) => task.position);
      const base = targetPositions.length > 0 ? Math.max(...targetPositions) : 0;
      // Position then id, the order the server relocates in.
      const relocating = [...movedLive, ...movedArchived].sort(
        (a, b) => a.position - b.position || a.id.localeCompare(b.id)
      );
      const movedPositions = new Map(
        relocating.map((task, index) => [task.id, base + (index + 1) * 1000])
      );
      const place = <T extends { id: string; column_id: string; position: number }>(task: T): T => {
        const newPosition = movedPositions.get(task.id);
        return newPosition === undefined
          ? task
          : { ...task, column_id: moveTasksTo, position: newPosition };
      };
      this.tasks = this.tasks.map(place);
      this.archivedTasks = this.archivedTasks.map(place);
    } else {
      this.tasks = this.tasks.filter((task) => task.column_id !== columnId);
      this.archivedTasks = this.archivedTasks.filter((task) => task.column_id !== columnId);
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
        const apply = <T extends { id: string; column_id: string; position: number }>(
          task: T
        ): T => {
          const movedTask = byId.get(task.id);
          return movedTask === undefined
            ? task
            : { ...task, column_id: movedTask.column_id, position: movedTask.position };
        };
        this.tasks = this.tasks.map(apply);
        this.archivedTasks = this.archivedTasks.map(apply);
      }
    } catch (error) {
      await this.#mutationFailed(error);
    } finally {
      for (const task of [...movedLive, ...movedArchived]) {
        taskActivity.invalidate(task.id);
      }
    }
  }

  // Archived cards stay put, matching the server: the column survives, so it is
  // still there to restore them into.
  async moveTasksToColumn(columnId: string, targetColumnId: string): Promise<void> {
    const moved = this.tasksInColumn(columnId);
    if (this.currentProjectId === null || moved.length === 0) {
      return;
    }
    const targetPositions = this.tasksInColumn(targetColumnId).map((task) => task.position);
    const base = targetPositions.length > 0 ? Math.max(...targetPositions) : 0;
    const optimistic = new Map(
      moved.map((task, index) => [task.id, base + (index + 1) * 1000] as const)
    );
    this.tasks = this.tasks.map((task) => {
      const position = optimistic.get(task.id);
      return position === undefined ? task : { ...task, column_id: targetColumnId, position };
    });
    try {
      const data = assertOk(
        await api.POST('/api/columns/{id}/move-tasks', {
          params: { path: { id: columnId } },
          body: { target_column_id: targetColumnId },
        })
      );
      const byId = new Map(data.moved_tasks.map((task) => [task.id, task]));
      this.tasks = this.tasks.map((task) => {
        const movedTask = byId.get(task.id);
        return movedTask === undefined
          ? task
          : { ...task, column_id: movedTask.column_id, position: movedTask.position };
      });
      // The reconcile leaves an unlisted task alone, so one the server refused to
      // move — already archived, per an event we have not seen — would otherwise
      // sit in the target column forever.
      if (data.moved_tasks.length !== moved.length) {
        await this.resync();
      }
    } catch (error) {
      await this.#mutationFailed(error);
    } finally {
      for (const task of moved) {
        taskActivity.invalidate(task.id);
      }
    }
  }

  async archiveTasksInColumn(columnId: string): Promise<void> {
    const archiving = this.tasksInColumn(columnId);
    if (this.currentProjectId === null || archiving.length === 0) {
      return;
    }
    const archivingIds = archiving.map((task) => task.id);
    this.#dropTasks(archivingIds);
    this.#discardArchivedLoad();
    const now = new Date().toISOString();
    this.archivedTasks = [
      ...archiving.map((task) => ({ ...task, archived_at: now })),
      ...this.archivedTasks,
    ];
    try {
      const data = assertOk(
        await api.POST('/api/columns/{id}/archive-tasks', { params: { path: { id: columnId } } })
      );
      const byId = new Map(data.tasks.map((task) => [task.id, task]));
      this.archivedTasks = this.archivedTasks.map((task) => byId.get(task.id) ?? task);
      // A card we dropped from the board but the server did not archive is gone
      // from both lists until something else refetches.
      if (data.tasks.length !== archiving.length) {
        await this.resync();
      }
    } catch (error) {
      this.archivedTasks = this.archivedTasks.filter((task) => !archivingIds.includes(task.id));
      await this.#mutationFailed(error);
    } finally {
      for (const id of archivingIds) {
        taskActivity.invalidate(id);
      }
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
    this.setFilters({
      ...this.filters,
      labelIds: this.filterLabelIds.filter((id) => id !== labelId),
    });
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
    } finally {
      taskActivity.invalidate(taskId);
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
    } finally {
      taskActivity.invalidate(taskId);
    }
  }

  async addBlocker(taskId: string, blockerTaskId: string): Promise<boolean> {
    const target = this.tasks.find((task) => task.id === taskId);
    if (target === undefined || target.blocker_ids.includes(blockerTaskId)) {
      return false;
    }
    const next = this.tasks.map((task) =>
      task.id === taskId ? { ...task, blocker_ids: [...task.blocker_ids, blockerTaskId] } : task
    );
    // Reject a cycle-forming edge before applying it, so the graph never flashes
    // its full-screen cycle state and the backend 409 toast never stacks on ours.
    const { nodes, edges } = buildGraph(next, this.columns);
    const onCycle = cycleNodeIds(nodes, edges);
    if (onCycle.size > 0) {
      const titleById = new Map(nodes.map((node) => [node.id, node.title]));
      const steps = cyclePathIds(edges, taskId, blockerTaskId).map((id) => ({
        id,
        title: titleById.get(id) ?? '',
      }));
      // A done task on the loop is one the graph may not be drawing, so the edge
      // that makes this a cycle can be nowhere on screen. `onCycle` also holds
      // everything downstream of the loop, so it only answers when nothing named it.
      const doneIds = new Set(nodes.filter((node) => node.isDone).map((node) => node.id));
      const throughDone =
        steps.length > 0
          ? steps.some((step) => doneIds.has(step.id))
          : nodes.some((node) => onCycle.has(node.id) && node.isDone);
      if (steps.length > 0) {
        this.#showCyclePath(steps);
      }
      toasts.error(
        cycleMessage(
          throughDone
            ? 'Adding this blocker would create a dependency cycle through a done task'
            : 'Adding this blocker would create a dependency cycle',
          steps.map((step) => step.title)
        )
      );
      return false;
    }
    this.tasks = next;
    try {
      assertOk(
        await api.POST('/api/tasks/{id}/blockers', {
          params: { path: { id: taskId } },
          body: { blocker_task_id: blockerTaskId },
        })
      );
      return true;
    } catch (error) {
      await this.#cycleConflictOrFail(error);
      return false;
    } finally {
      taskActivity.invalidate(taskId);
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
    } finally {
      taskActivity.invalidate(taskId);
    }
  }

  get filters(): BoardFilters {
    return {
      labelIds: this.filterLabelIds,
      assigneeIds: this.filterAssigneeIds,
      query: this.filterQuery,
    };
  }

  get filterSearch(): string {
    return filtersToSearch(this.filters);
  }

  setFilters(filters: BoardFilters): void {
    const labelIds = this.#knownLabelIds(filters.labelIds);
    if (filtersToSearch({ ...filters, labelIds }) !== this.filterSearch) {
      this.filterLabelIds = labelIds;
      this.filterAssigneeIds = filters.assigneeIds;
      this.filterQuery = filters.query;
    }
    // Written even when nothing changed: an incoming URL can name a filter the store
    // has already dropped, and only this takes it back out of the address bar.
    this.#writeFilterUrl();
  }

  // An id the loaded project does not know — a deleted label, or one from another
  // project's link — would dim the whole board with no chip to unpress.
  #knownLabelIds(labelIds: string[]): string[] {
    if (this.project === null) {
      return labelIds;
    }
    return labelIds.filter((id) => this.labels.some((label) => label.id === id));
  }

  #writeFilterUrl(): void {
    const route = router.current;
    if (route.name !== 'project' || route.params.id !== this.currentProjectId) {
      return;
    }
    const { pathname, search } = splitPath(router.path);
    const next = mergeFilterSearch(search, this.filters);
    if (search === next) {
      return;
    }
    // Replaces, so a run of filter edits collapses into one history entry.
    router.redirect(pathname + next);
  }

  toggleLabelFilter(labelId: string): void {
    this.setFilters({
      ...this.filters,
      labelIds: this.filterLabelIds.includes(labelId)
        ? this.filterLabelIds.filter((id) => id !== labelId)
        : [...this.filterLabelIds, labelId],
    });
  }

  toggleAssigneeFilter(userId: string): void {
    this.setFilters({
      ...this.filters,
      assigneeIds: this.filterAssigneeIds.includes(userId)
        ? this.filterAssigneeIds.filter((id) => id !== userId)
        : [...this.filterAssigneeIds, userId],
    });
  }

  setFilterQuery(query: string): void {
    this.setFilters({ ...this.filters, query });
  }

  clearFilters(): void {
    this.setFilters(noFilters());
  }

  get doneColumnIds(): Set<string> {
    return new Set(this.columns.filter((column) => column.is_done).map((column) => column.id));
  }

  get #normalizedQuery(): string {
    return this.filterQuery.trim().toLowerCase();
  }

  get hasActiveFilters(): boolean {
    return (
      this.filterLabelIds.length > 0 ||
      this.filterAssigneeIds.length > 0 ||
      this.#normalizedQuery !== ''
    );
  }

  /** Changes only when the filter changes in a way that can repartition a column. */
  get filterSignature(): string {
    return JSON.stringify([this.#normalizedQuery, this.filterLabelIds, this.filterAssigneeIds]);
  }

  taskMatchesFilters(task: BoardTask): boolean {
    const labelOk =
      this.filterLabelIds.length === 0 ||
      task.label_ids.some((id) => this.filterLabelIds.includes(id));
    const assigneeOk =
      this.filterAssigneeIds.length === 0 ||
      task.assignee_ids.some((id) => this.filterAssigneeIds.includes(id));
    const query = this.#normalizedQuery;
    const queryOk = query === '' || task.title.toLowerCase().includes(query);
    return labelOk && assigneeOk && queryOk;
  }

  displayTasksInColumn(columnId: string): BoardTask[] {
    const tasks = this.tasksInColumn(columnId);
    if (!this.hasActiveFilters) {
      return tasks;
    }
    const matches: BoardTask[] = [];
    const rest: BoardTask[] = [];
    for (const task of tasks) {
      (this.taskMatchesFilters(task) ? matches : rest).push(task);
    }
    return [...matches, ...rest];
  }

  matchingCountInColumn(columnId: string): number {
    return this.tasks.filter((task) => task.column_id === columnId && this.taskMatchesFilters(task))
      .length;
  }

  taskImages = $state<Record<string, TaskImage[]>>({});
  taskComments = $state<Record<string, TaskComment[]>>({});

  async loadTaskDetail(taskId: string): Promise<void> {
    try {
      const data = assertOk(await api.GET('/api/tasks/{id}', { params: { path: { id: taskId } } }));
      this.taskImages = { ...this.taskImages, [taskId]: data.images };
      this.taskComments = { ...this.taskComments, [taskId]: data.comments ?? [] };
      // Heals a card badge whose realtime event was missed; short of a full
      // board refetch this is the only authoritative read of either count.
      this.tasks = this.tasks.map((task) =>
        task.id === taskId
          ? { ...task, image_count: data.image_count, comment_count: data.comment_count ?? 0 }
          : task
      );
    } catch (error) {
      toasts.error(error instanceof ApiError ? error.message : 'Failed to load task details');
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
      await this.loadTaskDetail(taskId);
    }
  }

  #setCommentCount(taskId: string, next: (current: number) => number): void {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, comment_count: next(task.comment_count ?? 0) } : task
    );
  }

  // A no-op when the stream is not cached: the detail view fetches it on open,
  // and seeding a partial list here would leave that view showing only fragments.
  #replaceComments(taskId: string, next: (comments: TaskComment[]) => TaskComment[]): void {
    const cached = this.taskComments[taskId];
    if (cached === undefined) {
      return;
    }
    this.taskComments = { ...this.taskComments, [taskId]: next(cached) };
  }

  async createComment(taskId: string, body: CommentBody): Promise<void> {
    const id = newId();
    const now = new Date().toISOString();
    const optimistic: TaskComment = {
      id,
      task_id: taskId,
      user_id: session.user?.id ?? '',
      body,
      created_at: now,
      updated_at: now,
    };
    this.#replaceComments(taskId, (comments) => [...comments, optimistic]);
    this.#setCommentCount(taskId, (count) => count + 1);
    try {
      const created = assertOk(
        await api.POST('/api/comments', { body: { id, task_id: taskId, body } })
      );
      // A detail fetch landing mid-flight replaces the whole stream, so the
      // optimistic row may be gone and the server row has to be re-inserted.
      if (this.taskComments[taskId] === undefined) {
        await this.loadTaskDetail(taskId);
        return;
      }
      this.#replaceComments(taskId, (comments) =>
        comments.some((comment) => comment.id === id)
          ? comments.map((comment) => (comment.id === id ? created : comment))
          : [...comments, created].sort(chronological)
      );
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskDetail(taskId);
    }
  }

  // Unlike its siblings this one has an outcome: a rejected edit must leave the
  // caller's editor open, or the resync takes the user's rewrite with it.
  async updateComment(taskId: string, commentId: string, body: CommentBody): Promise<boolean> {
    const now = new Date().toISOString();
    this.#replaceComments(taskId, (comments) =>
      comments.map((comment) =>
        comment.id === commentId ? { ...comment, body, updated_at: now } : comment
      )
    );
    try {
      const updated = assertOk(
        await api.PATCH('/api/comments/{id}', {
          params: { path: { id: commentId } },
          body: { body },
        })
      );
      this.#replaceComments(taskId, (comments) =>
        comments.map((comment) => (comment.id === commentId ? updated : comment))
      );
      return true;
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskDetail(taskId);
      return false;
    }
  }

  async deleteComment(taskId: string, commentId: string): Promise<void> {
    this.#replaceComments(taskId, (comments) =>
      comments.filter((comment) => comment.id !== commentId)
    );
    this.#setCommentCount(taskId, (count) => Math.max(0, count - 1));
    try {
      assertOk(await api.DELETE('/api/comments/{id}', { params: { path: { id: commentId } } }));
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskDetail(taskId);
    }
  }

  // Idempotent direct patches from realtime events; an echo of our own mutation
  // re-applies the same values and is a no-op.
  applyRealtime(event: RealtimeEvent): void {
    if (this.readonly || event.project_id !== this.currentProjectId) {
      return;
    }
    switch (event.type) {
      case 'task_created': {
        const incoming = event.data as BoardTask;
        const task = { ...incoming, comment_count: incoming.comment_count ?? 0 };
        this.tasks = this.tasks.some((t) => t.id === task.id)
          ? this.tasks.map((t) => (t.id === task.id ? task : t))
          : [...this.tasks, task];
        break;
      }
      case 'task_updated': {
        // Update-only: a task_updated for a task we no longer hold means it was
        // deleted (a locally-deleted task whose in-flight edit — e.g. the detail
        // overlay's autosave flushed on close — lands after our optimistic remove).
        // Re-adding it here would resurrect a phantom node in the graph.
        const incoming = event.data as BoardTask;
        // An API pod that predates comments omits comment_count; replacing the whole
        // task with its payload would otherwise blank the badge until a full refetch.
        this.tasks = this.tasks.map((t) =>
          t.id === incoming.id
            ? { ...incoming, comment_count: incoming.comment_count ?? t.comment_count }
            : t
        );
        taskActivity.invalidate(incoming.id);
        break;
      }
      case 'task_deleted': {
        const { id } = event.data as { id: string };
        this.#dropTasks([id]);
        this.archivedTasks = this.archivedTasks.filter((t) => t.id !== id);
        break;
      }
      case 'task_archived': {
        const archived = event.data as ArchivedTask;
        this.#dropTasks([archived.id]);
        this.archivedTasks = this.archivedTasks.some((t) => t.id === archived.id)
          ? this.archivedTasks.map((t) => (t.id === archived.id ? archived : t))
          : [archived, ...this.archivedTasks];
        taskActivity.invalidate(archived.id);
        break;
      }
      case 'task_restored': {
        const restored = event.data as BoardTask;
        this.archivedTasks = this.archivedTasks.filter((t) => t.id !== restored.id);
        this.tasks = this.tasks.some((t) => t.id === restored.id)
          ? this.tasks.map((t) => (t.id === restored.id ? restored : t))
          : [...this.tasks, restored];
        taskActivity.invalidate(restored.id);
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
        taskActivity.invalidate(d.task_id);
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
        const relocate = <T extends { id: string; column_id: string; position: number }>(
          task: T
        ): T => {
          const m = moved.get(task.id);
          return m === undefined ? task : { ...task, column_id: m.column_id, position: m.position };
        };
        this.tasks = this.tasks.map(relocate).filter((t) => t.column_id !== d.id);
        this.archivedTasks = this.archivedTasks.map(relocate).filter((t) => t.column_id !== d.id);
        for (const movedTask of d.moved_tasks) {
          taskActivity.invalidate(movedTask.id);
        }
        break;
      }
      case 'column_tasks_moved': {
        const d = event.data as {
          moved_tasks: { id: string; column_id: string; position: number }[];
        };
        const moved = new Map(d.moved_tasks.map((m) => [m.id, m]));
        this.tasks = this.tasks.map((t) => {
          const m = moved.get(t.id);
          return m === undefined ? t : { ...t, column_id: m.column_id, position: m.position };
        });
        for (const movedTask of d.moved_tasks) {
          taskActivity.invalidate(movedTask.id);
        }
        break;
      }
      case 'column_tasks_archived': {
        const d = event.data as { column_id: string; tasks: ArchivedTask[] };
        this.#dropTasks(d.tasks.map((t) => t.id));
        const incoming = new Map(d.tasks.map((t) => [t.id, t]));
        this.archivedTasks = [
          ...d.tasks.filter((t) => !this.archivedTasks.some((held) => held.id === t.id)),
          ...this.archivedTasks.map((held) => incoming.get(held.id) ?? held),
        ];
        for (const task of d.tasks) {
          taskActivity.invalidate(task.id);
        }
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
        this.setFilters({
          ...this.filters,
          labelIds: this.filterLabelIds.filter((l) => l !== id),
        });
        break;
      }
      case 'image_created': {
        const d = event.data as TaskImage & { task_id: string; image_count: number };
        this.tasks = this.tasks.map((t) =>
          t.id === d.task_id ? { ...t, image_count: d.image_count } : t
        );
        const cached = this.taskImages[d.task_id];
        // Append to an open grid, skipping the uploader's own echo (already added
        // optimistically) so it does not show a duplicate thumbnail.
        if (cached !== undefined && !cached.some((img) => img.id === d.id)) {
          const image: TaskImage = {
            id: d.id,
            url: d.url,
            filename: d.filename,
            content_type: d.content_type,
            size_bytes: d.size_bytes,
            created_at: d.created_at,
          };
          this.taskImages = { ...this.taskImages, [d.task_id]: [...cached, image] };
        }
        break;
      }
      case 'image_deleted': {
        const d = event.data as { task_id: string; image_count: number };
        this.tasks = this.tasks.map((t) =>
          t.id === d.task_id ? { ...t, image_count: d.image_count } : t
        );
        // The event carries no image id, so re-fetch the grid; clearing the cache
        // entry instead would strand an open detail view on its loading spinner.
        if (this.taskImages[d.task_id] !== undefined) {
          void this.loadTaskDetail(d.task_id);
        }
        break;
      }
      case 'comment_created': {
        const d = event.data as TaskComment & { comment_count: number };
        this.#setCommentCount(d.task_id, () => d.comment_count);
        const comment: TaskComment = {
          id: d.id,
          task_id: d.task_id,
          user_id: d.user_id,
          body: d.body,
          created_at: d.created_at,
          updated_at: d.updated_at,
        };
        // Skips the author's own echo, which the optimistic append already placed.
        this.#replaceComments(d.task_id, (comments) =>
          comments.some((c) => c.id === comment.id)
            ? comments
            : [...comments, comment].sort(chronological)
        );
        break;
      }
      case 'comment_updated': {
        const d = event.data as TaskComment;
        this.#replaceComments(d.task_id, (comments) =>
          comments.map((c) =>
            c.id === d.id ? { ...c, body: d.body, updated_at: d.updated_at } : c
          )
        );
        break;
      }
      case 'comment_deleted': {
        const d = event.data as { id: string; task_id: string; comment_count: number };
        this.#setCommentCount(d.task_id, () => d.comment_count);
        this.#replaceComments(d.task_id, (comments) => comments.filter((c) => c.id !== d.id));
        break;
      }
    }
  }

  async #mutationFailed(error: unknown): Promise<void> {
    toasts.error(error instanceof ApiError ? error.message : 'Something went wrong');
    await this.resync();
  }

  async #cycleConflictOrFail(error: unknown): Promise<void> {
    const named = cycleFromApiError(error);
    if (named === null) {
      await this.#mutationFailed(error);
      return;
    }
    this.#showCyclePath(named.cycle);
    toasts.error(
      cycleMessage(
        named.message,
        named.cycle.map((step) => step.title)
      )
    );
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
