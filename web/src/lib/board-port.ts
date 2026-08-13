import type { BoardTask } from './board-types';
import type { SubmitInput, SubmitResult } from './outbox.svelte';

/**
 * What a sub-store may reach for on the board that owns it.
 *
 * Deliberately not the store itself. A sub-store handed `this` keeps every
 * coupling the split was meant to remove, and nothing then stops the next method
 * from reaching further — the interface is the only thing that makes "narrow"
 * enforceable rather than a habit.
 *
 * Methods rather than properties throughout: the implementation is built from
 * arrow functions in the store's constructor, so every read happens at call time
 * against the live `$state`. A plain property would have to be a getter to do the
 * same, and a getter in an object literal cannot see the store's `this`.
 */
export interface BoardPort {
  currentProjectId(): string | null;
  tasks(): BoardTask[];
  setTasks(tasks: BoardTask[]): void;
  tasksInColumn(columnId: string): BoardTask[];
  send<T>(input: Omit<SubmitInput, 'projectId'>): Promise<SubmitResult<T>>;
  sendOrFail<T>(
    input: Omit<SubmitInput, 'projectId'>,
    onFailure?: (error: unknown) => Promise<void>
  ): Promise<SubmitResult<T>>;
  mutationFailed(error: unknown): Promise<void>;
  loadTaskDetail(taskId: string): Promise<void>;
}
