import type { BoardPort } from './board-port';
import { optimisticTask } from './board-task';
import type { BoardTask, ChecklistItem } from './board-types';
import { nowIso } from './dates';
import { patchById, removeById } from './collections';
import { newId } from './ids';
import { append, byRank, placeAtIndex, type Placement } from './ranks';
import { taskActivity } from './taskActivity.svelte';
import { truncateTitle } from './titles';

export class BoardChecklists {
  byTask = $state<Record<string, ChecklistItem[]>>({});

  readonly #board: BoardPort;

  constructor(board: BoardPort) {
    this.#board = board;
  }

  setCounts(
    taskId: string,
    next: (counts: { total: number; done: number }) => { total: number; done: number }
  ): void {
    this.#board.setTasks(
      this.#board.tasks().map((task) => {
        if (task.id !== taskId) {
          return task;
        }
        const { total, done } = next({
          total: task.checklist_item_count ?? 0,
          done: task.checklist_done_count ?? 0,
        });
        return {
          ...task,
          checklist_item_count: Math.max(0, total),
          checklist_done_count: Math.max(0, done),
        };
      })
    );
  }

  // A no-op when the list is not cached, for the same reason the comment stream is.
  replace(taskId: string, next: (items: ChecklistItem[]) => ChecklistItem[]): void {
    const cached = this.byTask[taskId];
    if (cached === undefined) {
      return;
    }
    this.byTask = { ...this.byTask, [taskId]: next(cached) };
  }

  async add(taskId: string, text: string): Promise<void> {
    const id = newId();
    const now = nowIso();
    const placement = append(this.byTask[taskId] ?? []);
    const optimistic: ChecklistItem = {
      id,
      task_id: taskId,
      text,
      checked: false,
      ...placement,
      created_at: now,
      updated_at: now,
    };
    this.replace(taskId, (items) => [...items, optimistic]);
    this.setCounts(taskId, ({ total, done }) => ({ total: total + 1, done }));
    const result = await this.#board.send<ChecklistItem>({
      entityId: taskId,
      label: `New checklist item “${truncateTitle(text)}”`,
      semantics: 'create',
      request: {
        method: 'POST',
        path: '/api/checklist-items',
        body: { id, task_id: taskId, text, ...placement },
      },
    });
    taskActivity.invalidate(taskId);
    if (result.status === 'failed') {
      await this.#board.mutationFailed(result.error);
      await this.#board.loadTaskDetail(taskId);
      return;
    }
    if (result.status !== 'sent') {
      return;
    }
    // A detail fetch landing mid-flight replaces the whole list, so the optimistic
    // row may be gone and the server row has to be re-inserted.
    if (this.byTask[taskId] === undefined) {
      await this.#board.loadTaskDetail(taskId);
      return;
    }
    const created = result.data;
    this.replace(taskId, (items) =>
      items.some((item) => item.id === id)
        ? items.map((item) => (item.id === id ? created : item))
        : [...items, created].sort(byRank)
    );
  }

  async setChecked(taskId: string, itemId: string, checked: boolean): Promise<void> {
    const before = (this.byTask[taskId] ?? []).find((item) => item.id === itemId);
    const now = nowIso();
    this.replace(taskId, (items) =>
      patchById(items, itemId, (item) => ({ ...item, checked, updated_at: now }))
    );
    if (before !== undefined && before.checked !== checked) {
      this.setCounts(taskId, ({ total, done }) => ({
        total,
        done: checked ? done + 1 : done - 1,
      }));
    }
    await this.#patch(
      taskId,
      itemId,
      { checked },
      true,
      `${checked ? 'Checked' : 'Unchecked'} “${truncateTitle(before?.text ?? '')}”`
    );
  }

  async rename(taskId: string, itemId: string, text: string): Promise<void> {
    const now = nowIso();
    this.replace(taskId, (items) =>
      patchById(items, itemId, (item) => ({ ...item, text, updated_at: now }))
    );
    await this.#patch(
      taskId,
      itemId,
      { text },
      true,
      `Renamed a checklist item to “${truncateTitle(text)}”`
    );
  }

  // The only checklist write the server records no activity for, so the only one
  // that must not refetch the log.
  async move(taskId: string, itemId: string, placement: Placement): Promise<void> {
    this.replace(taskId, (items) =>
      patchById(items, itemId, (item) => ({ ...item, ...placement })).sort(byRank)
    );
    await this.#patch(taskId, itemId, { ...placement }, false, 'Reordered a checklist item');
  }

  async #patch(
    taskId: string,
    itemId: string,
    body: { text?: string; checked?: boolean; sort_key?: string },
    logged: boolean,
    label: string
  ): Promise<void> {
    const result = await this.#board.send<ChecklistItem>({
      entityId: itemId,
      label,
      request: {
        method: 'PATCH',
        path: '/api/checklist-items/{id}',
        pathParams: { id: itemId },
        body,
      },
    });
    if (result.status === 'sent') {
      const updated = result.data;
      this.replace(taskId, (items) => patchById(items, itemId, () => updated).sort(byRank));
    }
    if (result.status === 'failed') {
      await this.#board.mutationFailed(result.error);
      await this.#board.loadTaskDetail(taskId);
    }
    if (logged) {
      taskActivity.invalidate(taskId);
    }
  }

  async remove(taskId: string, itemId: string): Promise<void> {
    const removed = (this.byTask[taskId] ?? []).find((item) => item.id === itemId);
    this.replace(taskId, (items) => removeById(items, itemId));
    this.setCounts(taskId, ({ total, done }) => ({
      total: total - 1,
      done: removed?.checked === true ? done - 1 : done,
    }));
    const result = await this.#board.sendOrFail({
      entityId: itemId,
      label: `Deleted checklist item “${truncateTitle(removed?.text ?? '')}”`,
      request: {
        method: 'DELETE',
        path: '/api/checklist-items/{id}',
        pathParams: { id: itemId },
      },
    });
    if (result.status === 'failed') {
      await this.#board.loadTaskDetail(taskId);
    }
    taskActivity.invalidate(taskId);
  }

  // Inserts the new card rather than waiting for its realtime echo: the caller
  // navigates to it, and a card absent from `tasks` has no title to build a slug from.
  async promote(taskId: string, itemId: string): Promise<string | null> {
    const parent = this.#board.tasks().find((task) => task.id === taskId);
    const item = (this.byTask[taskId] ?? []).find((entry) => entry.id === itemId);
    if (parent === undefined || item === undefined) {
      return null;
    }
    const siblings = this.#board.tasksInColumn(parent.column_id);
    const placement = placeAtIndex(siblings, siblings.findIndex((task) => task.id === taskId) + 1);
    const id = newId();
    this.replace(taskId, (items) => removeById(items, itemId));
    this.setCounts(taskId, ({ total, done }) => ({
      total: total - 1,
      done: item.checked ? done - 1 : done,
    }));
    this.#board.setTasks([
      ...this.#board.tasks(),
      optimisticTask(id, parent.column_id, item.text, placement),
    ]);
    const result = await this.#board.send<BoardTask>({
      entityId: id,
      label: `Promoted “${truncateTitle(item.text)}” to a card`,
      semantics: 'create',
      request: {
        method: 'POST',
        path: '/api/checklist-items/{id}/promote',
        pathParams: { id: itemId },
        body: { id, ...placement },
      },
    });
    taskActivity.invalidate(taskId);
    if (result.status === 'failed') {
      await this.#board.mutationFailed(result.error);
      await this.#board.loadTaskDetail(taskId);
      return null;
    }
    if (result.status === 'sent') {
      const created = result.data;
      this.#board.setTasks(patchById(this.#board.tasks(), id, () => created));
    }
    return id;
  }
}
