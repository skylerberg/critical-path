/**
 * Revealing an element inside one scroll container, on the block axis only.
 *
 * `scrollIntoView` cannot be used anywhere inside the board: it walks EVERY
 * scrollable ancestor, and one of every card's ancestors is the board's
 * horizontal snap scroller — so it pans the board sideways, which then resolves
 * onto a different column. Everything here moves the container it is handed and
 * nothing else.
 */

interface VerticalSpan {
  top: number;
  bottom: number;
}

/**
 * The `scrollTop` delta bringing `target` inside `view`, moving as little as
 * possible — `scrollIntoView({ block: 'nearest' })` for one element, on one axis.
 *
 * A target taller than the view aligns to its top, as `nearest` does.
 */
export function verticalRevealDelta(view: VerticalSpan, target: VerticalSpan): number {
  if (target.top < view.top || target.bottom - target.top > view.bottom - view.top) {
    return target.top - view.top;
  }
  if (target.bottom > view.bottom) {
    return target.bottom - view.bottom;
  }
  return 0;
}

/**
 * Scroll `list` — and nothing else — the least needed to show `target`.
 * `scrollTo` rather than `scrollBy`: jsdom implements no `scrollBy` at all.
 */
export function revealInList(list: HTMLElement, target: HTMLElement, smooth: boolean): void {
  const delta = verticalRevealDelta(list.getBoundingClientRect(), target.getBoundingClientRect());
  if (delta === 0) {
    return;
  }
  list.scrollTo({ top: list.scrollTop + delta, behavior: smooth ? 'smooth' : 'auto' });
}
