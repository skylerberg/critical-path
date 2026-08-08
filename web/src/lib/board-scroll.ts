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

interface VerticalSpan {
  top: number;
  bottom: number;
}

/**
 * The `scrollTop` delta bringing `target` inside `view`, moving as little as
 * possible — `scrollIntoView({ block: 'nearest' })` for one element, on one
 * axis. The real thing walks EVERY scrollable ancestor, one of which is the
 * board's horizontal snap scroller: it pans the board, which then re-resolves
 * onto a different column.
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
 * How long after the finger lifts a scroll may still be attributed to that
 * gesture's momentum. A single fling settles well inside this; a second swipe
 * chained onto the first spans another drag as well, and lands outside it.
 */
export const MOMENTUM_WINDOW_MS = 800;

/**
 * Which snap target a fling that sailed past several should be pulled back to,
 * or `null` to leave the scroll where it landed.
 *
 * `scroll-snap-stop: always` is what caps a swipe at one column; this is the
 * fallback for an engine that ignores it during momentum, as WebKit did before
 * Safari 15. It has no true positives on any engine that also has `scrollend`,
 * so every guard here is deliberately biased toward doing nothing.
 *
 * @param origin   Index the board rested at when the finger went down.
 * @param atLift   Index it had reached when the finger came up.
 * @param settled  Index it came to rest at.
 * @param sinceLiftMs Time from the lift to the settle.
 */
export function overshootTarget(
  origin: number,
  atLift: number,
  settled: number,
  sinceLiftMs: number
): number | null {
  // Already capped, so nothing to correct.
  if (Math.abs(settled - origin) <= 1) {
    return null;
  }
  // The drag itself crossed a column: the user moved it there deliberately, and
  // only travel that came purely from momentum is the bug.
  if (Math.abs(atLift - origin) >= 1) {
    return null;
  }
  // Too late to be one momentum run, so the sequence held more than one gesture
  // — a second swipe iOS never reported, or a re-snap after a layout change.
  if (sinceLiftMs > MOMENTUM_WINDOW_MS) {
    return null;
  }
  return origin + Math.sign(settled - origin);
}

/** Inline-axis `scroll-snap-align` of a column. The board uses both. */
export type SnapAlign = 'start' | 'center';

/**
 * The `scrollLeft` that parks `target` on the scroller's snap position. Landing
 * short of it is not harmless: under mandatory snap the browser then rounds the
 * scroll to whichever snap point is nearest, which can be the next column over.
 *
 * A start-aligned column parks against the snapport's left edge, which
 * `scroll-padding-left` insets by the board's gutter. A center-aligned one parks
 * its center on the snapport's center, where symmetric scroll padding cancels
 * out — so that arm ignores it rather than pretending to use it.
 */
export function snapScrollLeft(
  scrollLeft: number,
  view: Span,
  target: Span,
  align: SnapAlign,
  scrollPaddingLeft: number
): number {
  if (align === 'center') {
    return scrollLeft + ((target.left + target.right) / 2 - (view.left + view.right) / 2);
  }
  return scrollLeft + (target.left - view.left - scrollPaddingLeft);
}
