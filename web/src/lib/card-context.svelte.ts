import { awayBoard, board, type BoardContext } from './board.svelte';
import { projects } from './projects.svelte';
import { router } from './router.svelte';
import { taskRoute } from './task-route.svelte';

export type CardContextStatus = 'ready' | 'loading' | 'error';

/**
 * Which board a quick menu or a palette action should read and write. A card
 * reached from My Tasks or Search belongs to a project whose payload the open
 * board does not hold, so a second one is loaded for it rather than replacing
 * the board the user is looking at.
 */
class CardContext {
  #ensuredTaskId: string | null = null;

  projectIdFor(taskId: string): string | null {
    const located = taskRoute.locate({ projectId: null, taskId });
    return located.status === 'ready' ? located.projectId : null;
  }

  storeFor(taskId: string): BoardContext {
    return this.#usesOpenBoard(taskId) ? board : awayBoard;
  }

  canWrite(taskId: string): boolean {
    if (this.#usesOpenBoard(taskId)) {
      return board.canEdit;
    }
    const projectId = this.projectIdFor(taskId);
    return projectId !== null && projects.canEdit(projectId);
  }

  statusFor(taskId: string): CardContextStatus {
    if (this.#usesOpenBoard(taskId)) {
      if (board.project !== null) {
        return 'ready';
      }
      return board.error !== null ? 'error' : 'loading';
    }
    const projectId = this.projectIdFor(taskId);
    if (projectId === null) {
      return taskRoute.locate({ projectId: null, taskId }).status === 'pending'
        ? 'loading'
        : 'error';
    }
    if (awayBoard.currentProjectId !== projectId) {
      return 'loading';
    }
    if (awayBoard.project !== null) {
      return 'ready';
    }
    return awayBoard.error !== null ? 'error' : 'loading';
  }

  /** Writes the same state the readers above track, so callers run it untracked. */
  ensure(taskId: string | null): void {
    if (taskId === null) {
      this.#ensuredTaskId = null;
      return;
    }
    if (this.#usesOpenBoard(taskId)) {
      return;
    }
    const projectId = this.projectIdFor(taskId);
    if (projectId === null) {
      taskRoute.ensure(taskId);
      return;
    }
    // Once per target rather than once per project: reopening a menu on the same
    // card must not refetch, but moving to another one revalidates what it reads.
    if (this.#ensuredTaskId === taskId) {
      return;
    }
    this.#ensuredTaskId = taskId;
    void awayBoard.load(projectId);
  }

  retry(taskId: string): void {
    this.#ensuredTaskId = null;
    if (this.#usesOpenBoard(taskId)) {
      void board.refetch();
      return;
    }
    this.ensure(taskId);
  }

  reset(): void {
    this.#ensuredTaskId = null;
    awayBoard.reset();
  }

  // A project route acts on the board it is showing and nothing else, including
  // for a card that board's payload does not hold — an archived one opened cold.
  #usesOpenBoard(taskId: string): boolean {
    if (board.readonly) {
      return false;
    }
    if (router.current.name === 'project') {
      return true;
    }
    const projectId = this.projectIdFor(taskId);
    return projectId !== null && projectId === board.currentProjectId;
  }
}

export const cardContext = new CardContext();
