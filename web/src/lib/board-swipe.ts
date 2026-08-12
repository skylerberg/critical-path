/**
 * The touch swipe that pages the board between columns.
 *
 * The board owns this gesture rather than letting the browser scroll and
 * correcting the result: `touch-action: pan-y` means no native horizontal pan and
 * no momentum, and `swipeTarget` decides the landing. See `board-scroll.ts` for
 * where the resulting scroll actually goes.
 */

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
 * long drag crossing two columns, and engines disagree about honoring it during
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
