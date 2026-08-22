/**
 * Where the board's horizontal scroller goes, and how fast.
 *
 * Pure geometry: the component supplies live rects and pointer positions, so
 * every decision here is unit-testable without a layout engine. The touch swipe
 * that chooses WHICH column to go to lives in `board-swipe.ts`.
 */

/**
 * Horizontal auto-scroll speed (px/sec) for the board while dragging, based on
 * how far the pointer is into the left/right edge band.
 *
 * The board does Trello-style drag scrolling: while a drag is in progress it
 * free-scrolls (no snap) at a slow, controllable speed, then snaps to the
 * destination column on drop. `svelte-dnd-action`'s built-in edge scroller is
 * both far too fast for precise placement and, under mandatory scroll-snap, a
 * per-frame fling — so we hide the board from it (`overflow: hidden` while
 * dragging) and drive the scroll ourselves with this speed.
 *
 * Returns 0 outside the band, scaling linearly up to `maxSpeedPxPerS` at the
 * very edge. Negative => scroll left, positive => scroll right. Kept pure so it
 * is trivially unit-testable; the component supplies the live pointer/rect
 * values each animation frame.
 *
 * @param pointerX   Pointer viewport-x.
 * @param boardLeft  Scroll container left edge (viewport-x).
 * @param boardRight Scroll container right edge (viewport-x).
 * @param zonePx     Width of the edge band on each side.
 * @param maxSpeedPxPerS Scroll speed at the very edge.
 */
export function edgeScrollSpeed(
  pointerX: number,
  boardLeft: number,
  boardRight: number,
  zonePx: number,
  maxSpeedPxPerS: number
): number {
  const fromLeft = pointerX - boardLeft; // < zonePx when inside the left band
  const fromRight = boardRight - pointerX; // < zonePx when inside the right band
  if (fromLeft < zonePx) {
    return -clamp01((zonePx - fromLeft) / zonePx) * maxSpeedPxPerS;
  }
  if (fromRight < zonePx) {
    return clamp01((zonePx - fromRight) / zonePx) * maxSpeedPxPerS;
  }
  return 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

interface Span {
  left: number;
  right: number;
}

// Sub-pixel layout puts a column flush against an edge a fraction outside it,
// and reading that as clipped would slide the board for nothing the user can see.
const EDGE_TOLERANCE_PX = 1;

/**
 * Is `target` entirely within `view` horizontally? A `DOMRect` satisfies `Span`,
 * so callers pass rects straight through.
 */
export function fitsHorizontally(view: Span, target: Span): boolean {
  return (
    target.left >= view.left - EDGE_TOLERANCE_PX && target.right <= view.right + EDGE_TOLERANCE_PX
  );
}

/**
 * Inline-axis `scroll-snap-align` of a snap target. The board uses all three:
 * the first column starts, the last target ends, everything between centers.
 */
export type SnapAlign = 'start' | 'center' | 'end';

/** The scroller's inline-axis `scroll-padding`. Both edges, since `end` reads the right. */
export interface SnapPadding {
  left: number;
  right: number;
}

/**
 * The `scrollLeft` that parks `target` on the scroller's snap position. Landing
 * short of it is not harmless: under mandatory snap the browser then rounds the
 * scroll to whichever snap point is nearest, which can be the next column over.
 *
 * A start-aligned column parks against the snapport's left edge and an
 * end-aligned one against its right, each inset by the board's gutter on that
 * side. A center-aligned one parks its center on the snapport's center, where
 * symmetric scroll padding cancels out — so that arm ignores it rather than
 * pretending to use it.
 */
export function snapScrollLeft(
  scrollLeft: number,
  view: Span,
  target: Span,
  align: SnapAlign,
  padding: SnapPadding
): number {
  if (align === 'center') {
    return scrollLeft + ((target.left + target.right) / 2 - (view.left + view.right) / 2);
  }
  if (align === 'end') {
    return scrollLeft + (target.right - view.right + padding.right);
  }
  return scrollLeft + (target.left - view.left - padding.left);
}

/**
 * Index of the snap position nearest `scrollLeft` — where the board is resting,
 * and so which column a swipe counts from.
 *
 * Positions rather than element centers, because the board no longer aligns its
 * targets the same way: measuring the distance from the snapport's midpoint to
 * each target's midpoint only names the resting target while every one of them
 * centers. Against a start-aligned first column it names its neighbor as soon as
 * two columns fit at once, and the swipe then counts from the wrong one and skips
 * a column.
 *
 * Positions are not clamped to the scroll range: on a board whose ends align to
 * the edges every one of them is reachable, so there is nothing to clamp.
 */
export function nearestSnapIndex(scrollLeft: number, positions: readonly number[]): number {
  let best = 0;
  let bestDistance = Infinity;
  positions.forEach((position, index) => {
    const distance = Math.abs(position - scrollLeft);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}
