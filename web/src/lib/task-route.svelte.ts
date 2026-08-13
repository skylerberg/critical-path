import { api, ApiError, assertOk } from '../api/client';
import { board } from './board.svelte';
import { myTasks } from './myTasks.svelte';
import { router } from './router.svelte';
import { search } from './search.svelte';

export type Located =
  | { status: 'ready'; projectId: string }
  | { status: 'pending' }
  | { status: 'not-found' }
  | { status: 'error' };

interface ProjectParams {
  projectId: string | null;
  taskId?: string;
}

class TaskRouteResolver {
  #byTask = $state<Record<string, string>>({});
  #failed = $state<Record<string, 'not-found' | 'error'>>({});
  #inflight = new Set<string>();

  // Side-effect free so it is safe inside a $derived; a later payload flips a
  // pending target to ready on its own. Fetching is ensure()'s job alone.
  locate(params: ProjectParams): Located {
    if (params.projectId !== null) {
      return { status: 'ready', projectId: params.projectId };
    }
    const taskId = params.taskId;
    if (taskId === undefined) {
      return { status: 'not-found' };
    }
    const local = this.#fromLoadedPayloads(taskId);
    if (local !== null) {
      return { status: 'ready', projectId: local };
    }
    const cached = this.#byTask[taskId];
    if (cached !== undefined) {
      return { status: 'ready', projectId: cached };
    }
    const failure = this.#failed[taskId];
    return failure === undefined ? { status: 'pending' } : { status: failure };
  }

  // The anonymous public board is excluded: its payload proves nothing about a
  // task the signed-in app is trying to open.
  #fromLoadedPayloads(taskId: string): string | null {
    const current = board.currentProjectId;
    if (
      current !== null &&
      !board.readonly &&
      (board.tasks.some((t) => t.id === taskId) || board.archivedTasks.some((t) => t.id === taskId))
    ) {
      return current;
    }
    for (const task of myTasks.tasks) {
      if (task.id === taskId) {
        return task.project_id;
      }
      for (const link of [...task.blocking, ...task.blocked_by]) {
        if (link.id === taskId) {
          return link.project_id;
        }
      }
    }
    for (const group of [...myTasks.waitingOnYou, ...myTasks.youAreWaitingOn]) {
      for (const link of group.tasks) {
        if (link.id === taskId) {
          return link.project_id;
        }
      }
    }
    const hit = search.results.find((result) => result.task_id === taskId);
    return hit?.project_id ?? null;
  }

  // As authoritative as the lookup it saves: the caller was authorized for the read
  // that named the project. Without it the jump would tear the screen down for a
  // spinner instead of resolving on the same tick.
  seed(taskId: string, projectId: string): void {
    if (this.#byTask[taskId] === undefined) {
      this.#byTask = { ...this.#byTask, [taskId]: projectId };
    }
  }

  ensure(taskId: string): void {
    if (
      this.#inflight.has(taskId) ||
      this.#byTask[taskId] !== undefined ||
      this.#failed[taskId] === 'not-found'
    ) {
      return;
    }
    this.#inflight.add(taskId);
    // Dropped up front so a retry loads instead of re-rendering what it is retrying.
    if (this.#failed[taskId] !== undefined) {
      const remaining = { ...this.#failed };
      delete remaining[taskId];
      this.#failed = remaining;
    }
    void this.#lookup(taskId).finally(() => this.#inflight.delete(taskId));
  }

  async #lookup(taskId: string): Promise<void> {
    try {
      const detail = assertOk(
        await api.GET('/api/tasks/{id}', { params: { path: { id: taskId } } })
      );
      this.#byTask = { ...this.#byTask, [taskId]: detail.project_id };
      // The whole card, not just the project it names. This read is the same one
      // the overlay makes on open, and the overlay opens a moment later on every
      // path that gets here — so handing it over is the difference between one
      // GET /api/tasks/{id} and two back to back.
      board.offerTaskDetail(detail);
    } catch (error) {
      // A 404 is also what no-access returns, deliberately, and is the only answer
      // worth keeping: anything else is transient, so ensure() will ask again.
      const missing = error instanceof ApiError && error.status === 404;
      this.#failed = { ...this.#failed, [taskId]: missing ? 'not-found' : 'error' };
    }
  }

  reset(): void {
    this.#byTask = {};
    this.#failed = {};
    this.#inflight.clear();
  }
}

export const taskRoute = new TaskRouteResolver();

// A shared read-only board names a project too, but not one its visitor may act
// on, so only the signed-in project routes answer here.
export function currentProjectId(): string | null {
  const route = router.current;
  if (route.name !== 'project') {
    return null;
  }
  const located = taskRoute.locate(route.params);
  return located.status === 'ready' ? located.projectId : null;
}
