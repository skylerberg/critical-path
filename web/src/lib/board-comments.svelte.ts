import type { BoardPort } from './board-port';
import type { CommentBody, TaskComment } from './board-types';
import { nowIso } from './dates';
import { patchById, removeById } from './collections';
import { newId } from './ids';
import { session } from './session.svelte';

export function chronological(a: TaskComment, b: TaskComment): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

export class BoardComments {
  byTask = $state<Record<string, TaskComment[]>>({});

  readonly #board: BoardPort;

  constructor(board: BoardPort) {
    this.#board = board;
  }

  setCount(taskId: string, next: (current: number) => number): void {
    this.#board.setTasks(
      this.#board
        .tasks()
        .map((task) =>
          task.id === taskId ? { ...task, comment_count: next(task.comment_count ?? 0) } : task
        )
    );
  }

  // A no-op when the stream is not cached: the detail view fetches it on open,
  // and seeding a partial list here would leave that view showing only fragments.
  replace(taskId: string, next: (comments: TaskComment[]) => TaskComment[]): void {
    const cached = this.byTask[taskId];
    if (cached === undefined) {
      return;
    }
    this.byTask = { ...this.byTask, [taskId]: next(cached) };
  }

  // Reports its outcome for the same reason `update` does: the composer clears
  // itself before the write lands, so a rejection it never hears about takes the
  // typed text with it.
  async create(taskId: string, body: CommentBody): Promise<boolean> {
    const id = newId();
    const now = nowIso();
    const optimistic: TaskComment = {
      id,
      task_id: taskId,
      user_id: session.user?.id ?? '',
      body,
      created_at: now,
      updated_at: now,
    };
    this.replace(taskId, (comments) => [...comments, optimistic]);
    this.setCount(taskId, (count) => count + 1);
    const result = await this.#board.sendOrFail<TaskComment>(
      {
        entityId: taskId,
        label: 'New comment',
        semantics: 'create',
        request: { method: 'POST', path: '/api/comments', body: { id, task_id: taskId, body } },
      },
      // The card, not the board: a rejected comment leaves nothing else wrong,
      // and the default handler would re-read the whole board to find that out.
      (error) => this.#board.detailMutationFailed(taskId, error)
    );
    if (result.status === 'failed') {
      return false;
    }
    if (result.status !== 'sent') {
      return true;
    }
    // A detail fetch landing mid-flight replaces the whole stream, so the
    // optimistic row may be gone and the server row has to be re-inserted.
    if (this.byTask[taskId] === undefined) {
      await this.#board.loadTaskDetail(taskId);
      return true;
    }
    const created = result.data;
    this.replace(taskId, (comments) =>
      comments.some((comment) => comment.id === id)
        ? comments.map((comment) => (comment.id === id ? created : comment))
        : [...comments, created].sort(chronological)
    );
    return true;
  }

  // Its outcome matters for the same reason create's does: a rejected edit must
  // leave the caller's editor open, or the resync takes the user's rewrite with it.
  async update(taskId: string, commentId: string, body: CommentBody): Promise<boolean> {
    const now = nowIso();
    this.replace(taskId, (comments) =>
      patchById(comments, commentId, (comment) => ({ ...comment, body, updated_at: now }))
    );
    const result = await this.#board.sendOrFail<TaskComment>(
      {
        entityId: commentId,
        label: 'Edited a comment',
        request: {
          method: 'PATCH',
          path: '/api/comments/{id}',
          pathParams: { id: commentId },
          body: { body },
        },
      },
      (error) => this.#board.detailMutationFailed(taskId, error)
    );
    if (result.status === 'failed') {
      return false;
    }
    if (result.status === 'sent') {
      const updated = result.data;
      this.replace(taskId, (comments) => patchById(comments, commentId, () => updated));
    }
    return true;
  }

  async remove(taskId: string, commentId: string): Promise<void> {
    this.replace(taskId, (comments) => removeById(comments, commentId));
    this.setCount(taskId, (count) => Math.max(0, count - 1));
    await this.#board.sendOrFail(
      {
        entityId: commentId,
        label: 'Deleted a comment',
        request: { method: 'DELETE', path: '/api/comments/{id}', pathParams: { id: commentId } },
      },
      (error) => this.#board.detailMutationFailed(taskId, error)
    );
  }
}
