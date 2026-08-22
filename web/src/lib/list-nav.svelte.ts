/**
 * A keyboard highlight over a filterable list, held as the row's identity rather
 * than its position. Rows shift under an open menu — a teammate deleting a label
 * drops it from `board.labels` mid-keystroke — and a highlight stored as an index
 * then names a different row than the one under it, so Enter acts on a row nobody
 * chose.
 *
 * Enter and Escape stay with the caller. What activation costs differs per menu
 * (an uncreatable task with no undo, board access for a stranger, a reversible
 * toggle), and Escape is a menu's relationship with its host, not navigation.
 */

/** Where a highlighted key that no longer names a row lands. */
export type MissingHighlight = 'first' | 'inert';

export interface ListNavOptions {
  /** The rows' identities, in display order. */
  keys: () => readonly string[];
  /** The scroll container. Its rows carry `data-index`. */
  list: () => HTMLElement | null | undefined;
  missing: MissingHighlight;
}

export class ListNav {
  readonly #keys: () => readonly string[];
  readonly #list: () => HTMLElement | null | undefined;
  readonly #missing: MissingHighlight;

  #chosen = $state<string | null>(null);

  /** The highlighted row's position, or -1 when no row is highlighted. */
  index = $derived.by<number>(() => {
    const keys = this.#keys();
    if (keys.length === 0) {
      return -1;
    }
    // Null is "no choice yet, so the first row". Only a key the user did choose
    // and that has since vanished is what `missing` decides.
    if (this.#chosen === null) {
      return 0;
    }
    const found = keys.indexOf(this.#chosen);
    if (found !== -1) {
      return found;
    }
    return this.#missing === 'first' ? 0 : -1;
  });

  /** The highlighted row's identity, resolved against the rows on screen. */
  activeKey = $derived.by<string | null>(() =>
    this.index === -1 ? null : (this.#keys()[this.index] ?? null)
  );

  constructor({ keys, list, missing }: ListNavOptions) {
    this.#keys = keys;
    this.#list = list;
    this.#missing = missing;
  }

  highlight(key: string): void {
    this.#chosen = key;
  }

  /** Back to "no choice yet" — what a fresh query leaves behind. */
  clear(): void {
    this.#chosen = null;
  }

  /**
   * Move one row and reveal it. False when there was no row to move to, so the
   * caller can leave the key to the caret instead of swallowing it.
   */
  move(delta: 1 | -1): boolean {
    const keys = this.#keys();
    if (keys.length === 0) {
      return false;
    }
    const next = Math.min(keys.length - 1, Math.max(0, this.index + delta));
    this.#chosen = keys[next]!;
    this.#reveal(next);
    return true;
  }

  // Takes the index rather than reading `index` back, because this runs before
  // the assignment above has propagated. Safe to touch the DOM here: an arrow key
  // moves the highlight but never the row set.
  #reveal(index: number): void {
    const list = this.#list();
    const target = list?.querySelector<HTMLElement>(`[data-index="${String(index)}"]`);
    if (list == null || target == null) {
      return;
    }
    // `scrollIntoView`, not `revealInList`, and the difference matters: a picker
    // in a Popover sits in two nested scrollports, and moving only the inner one
    // leaves the row behind the panel's edge. Walking every ancestor is safe here
    // and nowhere on the board — see scroll-reveal.ts — because these menus render
    // in a dialog or popover that is a sibling of the board, not a descendant.
    target.scrollIntoView({ block: 'nearest' });
    // Focus follows the highlight only once it is already inside the list;
    // arrowing from the filter field must not steal focus away from it.
    if (list.contains(document.activeElement)) {
      target.focus();
    }
  }
}
