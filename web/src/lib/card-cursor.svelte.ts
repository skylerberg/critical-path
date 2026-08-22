import { untrack } from 'svelte';

export type CursorDirection = 'up' | 'down';

export function focusCardRow(taskId: string): void {
  document.querySelector<HTMLElement>(`[data-card-row="${CSS.escape(taskId)}"]`)?.focus();
}

/**
 * The card in context on a screen that is a flat list of them rather than a board:
 * My Tasks and Search. The board has its own cursor, which knows about columns.
 */
class CardCursorStore {
  taskId = $state<string | null>(null);

  #rows = $state<readonly string[]>([]);

  /**
   * The screen republishes its rows whenever they change, so a card a teammate
   * finishes or a narrowed search drops takes the cursor with it rather than
   * leaving an action pointed at a row nobody can see.
   */
  setRows(taskIds: readonly string[]): void {
    this.#rows = taskIds;
    // Untracked: the screen publishes from an effect, and reading the cursor there
    // would make every cursor move re-run — and re-publish — the rows.
    untrack(() => {
      if (this.taskId !== null && !taskIds.includes(this.taskId)) {
        this.taskId = null;
      }
    });
  }

  set(taskId: string): void {
    this.taskId = taskId;
  }

  move(direction: CursorDirection): boolean {
    const rows = this.#rows;
    if (rows.length === 0) {
      return false;
    }
    const at = this.taskId === null ? -1 : rows.indexOf(this.taskId);
    const next =
      at === -1
        ? rows[0]!
        : rows[Math.min(rows.length - 1, Math.max(0, at + (direction === 'down' ? 1 : -1)))]!;
    this.taskId = next;
    focusCardRow(next);
    return true;
  }

  // The cursor only, never the rows: a refreshed list keeps its cursor, and the
  // arriving screen owns the rows whichever order two screens swap in. That is
  // why a list view clears on the way out rather than on the way in.
  clear(): void {
    this.taskId = null;
  }

  reset(): void {
    this.taskId = null;
    this.#rows = [];
  }
}

export const cardCursor = new CardCursorStore();
