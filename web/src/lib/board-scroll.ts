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
 * The `scrollLeft` that parks `target` on the scroller's snap position, given the
 * container's `scroll-padding-left`. Landing short of it by the gutter width is
 * not harmless: under mandatory snap the browser then rounds the scroll to
 * whichever snap point is nearest, which can be the next column over.
 */
export function snapScrollLeft(
  scrollLeft: number,
  view: Span,
  target: Span,
  scrollPaddingLeft: number
): number {
  return scrollLeft + (target.left - view.left - scrollPaddingLeft);
}
