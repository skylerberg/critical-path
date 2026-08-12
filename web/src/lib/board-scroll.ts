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

/** Finger travel that commits a swipe to the next column. */
export const SWIPE_COMMIT_PX = 44;
/** ...or the speed at which a short flick commits anyway. */
export const SWIPE_COMMIT_PX_PER_S = 300;
/** Travel on either axis before a gesture is judged horizontal or vertical. */
export const SWIPE_AXIS_LOCK_PX = 8;
/**
 * Shortest interval velocity may be measured over. Dividing by a sub-frame gap
 * turns a few pixels of jitter into thousands of px/s, which would page the board
 * off the end of a slow drag the user meant to abandon.
 */
export const SWIPE_VELOCITY_SAMPLE_MS = 8;

/**
 * Where a finished swipe should land, as an index into the board's snap targets.
 *
 * The cap is structural: the result is `origin`, `origin - 1` or `origin + 1` and
 * nothing else can be expressed. That is the point. `scroll-snap-stop: always`
 * only constrains the *inertial* phase of a native scroll, so it cannot stop a
 * long drag crossing two columns, and engines disagree about honouring it during
 * momentum at all — leaving the browser to choose and correcting afterwards is
 * what made the board jump back.
 *
 * @param origin  Snap index the board rested at when the finger went down.
 * @param dx      Net finger travel; negative means the content advances.
 * @param velocityPxPerS Finger speed at release, same sign as `dx`.
 * @param lastIndex Highest selectable snap index.
 */
export function swipeTarget(
  origin: number,
  dx: number,
  velocityPxPerS: number,
  lastIndex: number
): number {
  const committed =
    Math.abs(dx) >= SWIPE_COMMIT_PX || Math.abs(velocityPxPerS) >= SWIPE_COMMIT_PX_PER_S;
  if (!committed || dx === 0) {
    return origin;
  }
  return Math.min(lastIndex, Math.max(0, origin + (dx < 0 ? 1 : -1)));
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
