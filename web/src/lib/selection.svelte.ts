import { SvelteSet } from 'svelte/reactivity';
import { announcer } from './announcer.svelte';
import { board } from './board.svelte';
import { toasts } from './toasts.svelte';

export type NavDirection = 'up' | 'down' | 'left' | 'right';

// Mirrors the bulk endpoints' own cap, so the UI can never propose an action the
// server would refuse.
export const MAX_SELECTION = 100;

/**
 * `grid[c]` is the ordered task ids of column `c`, columns left-to-right.
 * Horizontal moves land on the nearest existing row of the next non-empty column.
 */
export function nextSelection(
  grid: readonly (readonly string[])[],
  current: string | null,
  direction: NavDirection
): string | null {
  const flat = grid.flat();
  if (flat.length === 0) {
    return null;
  }
  let col = -1;
  let row = -1;
  if (current !== null) {
    for (let c = 0; c < grid.length; c++) {
      const r = grid[c]!.indexOf(current);
      if (r !== -1) {
        col = c;
        row = r;
        break;
      }
    }
  }
  if (col === -1) {
    return flat[0]!;
  }
  if (direction === 'up') {
    return grid[col]![Math.max(0, row - 1)] ?? current;
  }
  if (direction === 'down') {
    return grid[col]![Math.min(grid[col]!.length - 1, row + 1)] ?? current;
  }
  const step = direction === 'left' ? -1 : 1;
  for (let c = col + step; c >= 0 && c < grid.length; c += step) {
    const column = grid[c]!;
    if (column.length > 0) {
      return column[Math.min(row, column.length - 1)]!;
    }
  }
  return current;
}

class SelectionStore {
  cursorTaskId = $state<string | null>(null);

  readonly #picked = new SvelteSet<string>();
  #anchorId: string | null = null;
  #rangeBase = new Set<string>();
  #atCap = false;

  // Filtered against the live board on every read, so a card a teammate deletes,
  // archives, or takes away with its column leaves the selection with no prune to
  // call and no window in which a dead id can reach a bulk request.
  readonly #liveIds = $derived.by<string[]>(() => {
    if (this.#picked.size === 0) {
      return [];
    }
    const ids: string[] = [];
    for (const column of board.columns) {
      for (const task of board.tasksInColumn(column.id)) {
        if (this.#picked.has(task.id)) {
          ids.push(task.id);
        }
      }
    }
    return ids;
  });
  readonly #liveSet = $derived(new Set(this.#liveIds));

  /**
   * Position order, not display order: a transient filter must not decide where
   * the cards land after a bulk move.
   *
   * Live, never a snapshot, so a menu deriving its target set from this drops a
   * card a teammate deletes mid-gesture without a line of code at the call site.
   */
  get selectedIds(): string[] {
    return this.#liveIds;
  }

  get count(): number {
    return this.#liveIds.length;
  }

  has(taskId: string): boolean {
    return this.#liveSet.has(taskId);
  }

  /** The set when the card is in it, else that card alone. */
  targetsFor(taskId: string | null): string[] {
    if (taskId === null) {
      return [];
    }
    return this.has(taskId) ? this.#liveIds : [taskId];
  }

  get cursorColumnId(): string | null {
    const id = this.cursorTaskId;
    if (id === null) {
      return null;
    }
    return board.tasks.find((task) => task.id === id)?.column_id ?? null;
  }

  set(taskId: string): void {
    this.cursorTaskId = taskId;
  }

  /** A right-click inside the set keeps it; outside it, the set collapses. */
  activate(taskId: string): void {
    this.cursorTaskId = taskId;
    if (!this.has(taskId)) {
      this.#picked.clear();
    }
    this.#anchorId = taskId;
    this.#rangeBase = new Set(this.#picked);
  }

  toggle(taskId: string): void {
    if (!board.canEdit) {
      return;
    }
    if (this.has(taskId)) {
      this.#picked.delete(taskId);
    } else {
      this.#picked.add(taskId);
    }
    // Anchor before capping, so the card just clicked is the one the cap counts
    // outward from rather than the first casualty of a set already at 100.
    this.cursorTaskId = taskId;
    this.#anchorId = taskId;
    this.#capped();
    this.#rangeBase = new Set(this.#picked);
    this.#announce();
  }

  extendTo(taskId: string): void {
    if (!board.canEdit) {
      return;
    }
    const anchor = this.#anchorId;
    const columnId = this.#columnOf(taskId);
    if (anchor === null || columnId === null || this.#columnOf(anchor) !== columnId) {
      this.toggle(taskId);
      return;
    }
    this.#selectRun(columnId, anchor, taskId);
    this.cursorTaskId = taskId;
    this.#announce();
  }

  extend(direction: NavDirection): void {
    // A viewer still navigates with the key; only the set is off limits to them.
    // Sideways, a range would sweep up every intervening column, and "between"
    // depends on a horizontal order nobody holds in their head.
    if (!board.canEdit || direction === 'left' || direction === 'right') {
      this.move(direction);
      return;
    }
    const from = this.cursorTaskId;
    const fromColumn = from === null ? null : this.#columnOf(from);
    // Hovering moves the cursor and not the anchor, so a run left over from
    // another column would select nothing at all. Re-anchor instead.
    if (
      fromColumn === null ||
      this.#anchorId === null ||
      this.#columnOf(this.#anchorId) !== fromColumn
    ) {
      this.#rangeBase = new Set(this.#picked);
      this.#anchorId = fromColumn === null ? null : from;
    }
    this.#moveCursor(direction);
    // With no cursor the move only establishes one, so that card anchors the run
    // rather than ending it.
    this.#anchorId ??= this.cursorTaskId;
    const anchor = this.#anchorId;
    const cursor = this.cursorTaskId;
    const columnId = cursor === null ? null : this.#columnOf(cursor);
    if (anchor === null || cursor === null || columnId === null) {
      return;
    }
    this.#selectRun(columnId, anchor, cursor);
    this.#announce();
  }

  move(direction: NavDirection): void {
    this.#moveCursor(direction);
    // Navigating away without extending ends the run, so the next Shift+Arrow
    // starts from where the user is rather than where they once were.
    this.#anchorId = null;
  }

  clear(): void {
    this.cursorTaskId = null;
    this.#picked.clear();
    this.#anchorId = null;
    this.#rangeBase = new Set();
    this.#atCap = false;
  }

  #moveCursor(direction: NavDirection): void {
    const grid = board.columns.map((column) =>
      board.displayTasksInColumn(column.id).map((task) => task.id)
    );
    const next = nextSelection(grid, this.cursorTaskId, direction);
    if (next !== null) {
      this.cursorTaskId = next;
    }
  }

  #columnOf(taskId: string): string | null {
    return board.tasks.find((task) => task.id === taskId)?.column_id ?? null;
  }

  // Recomputed from the base rather than accumulated, which is what makes
  // reversing direction shrink the run instead of growing it. Display order, so
  // shift-click and Shift+Arrow agree with what is on screen under a filter.
  #selectRun(columnId: string, fromId: string, toId: string): void {
    const ids = board.displayTasksInColumn(columnId).map((task) => task.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    this.#picked.clear();
    for (const id of this.#rangeBase) {
      this.#picked.add(id);
    }
    if (from !== -1 && to !== -1) {
      for (const id of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        this.#picked.add(id);
      }
    }
    this.#capped();
  }

  #capped(): void {
    const live = this.#liveIds;
    if (live.length <= MAX_SELECTION) {
      this.#atCap = false;
      return;
    }
    const keep = new Set(this.#nearestTheAnchor(live).slice(0, MAX_SELECTION));
    this.#picked.clear();
    for (const id of live) {
      if (keep.has(id)) {
        this.#picked.add(id);
      }
    }
    // Every further press of a held Shift+Arrow overflows again, and twenty
    // identical refusals are a wall, not a message.
    if (!this.#atCap) {
      toasts.info(`You can select at most ${String(MAX_SELECTION)} cards at a time`);
    }
    this.#atCap = true;
  }

  // Board order would always cut the run's *last* ids, and a run grown upward
  // ends at its anchor: the set would then slide one card per press away from
  // the card the user started on, still reading 100 and still silent, because
  // the toast fires only on the press that first overflowed.
  #nearestTheAnchor(live: readonly string[]): string[] {
    const anchor = this.#anchorId === null ? -1 : live.indexOf(this.#anchorId);
    if (anchor === -1) {
      return [...live];
    }
    return live
      .map((id, index) => ({ id, distance: Math.abs(index - anchor) }))
      .sort((a, b) => a.distance - b.distance)
      .map((entry) => entry.id);
  }

  #announce(): void {
    const count = this.count;
    void announcer.announce(`${String(count)} card${count === 1 ? '' : 's'} selected`);
  }
}

export const selection = new SelectionStore();
