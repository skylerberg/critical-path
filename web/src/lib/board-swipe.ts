/**
 * The touch swipe that pages the board between columns.
 *
 * The board owns this gesture rather than letting the browser scroll and
 * correcting the result: `swipeTarget` decides the landing and `settleScrollLeft`
 * drives the slide to it. See `board-scroll.ts` for where that scroll goes.
 *
 * `touch-action: pan-y` asks the browser for no horizontal pan and no momentum,
 * but it is a declaration and not enforcement — so the component calls
 * `preventDefault()` on the moves it has claimed as well. Owning the gesture means
 * nothing if the browser is also scrolling the same element.
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
/** How long the slide that closes a swipe takes. */
export const SWIPE_SETTLE_MS = 260;

/**
 * Where the closing slide should be `elapsed` ms in — an ease-out the board runs
 * itself, frame by frame, rather than handing the landing to
 * `scrollTo({ behavior: 'smooth' })`.
 *
 * The browser's smooth scroll ends at a moment only the browser knows, and the
 * board has to know it: mandatory snap may only be re-armed once the scroller is
 * stationary and exactly on the position. `scrollend` answers that question on
 * engines that have it (Safari only from 26.2), and the half-second fallback
 * behind it answers it wrongly on the rest — re-arming mid-animation, whereupon
 * the browser resolves the still-moving scroll onto the NEXT snap position and the
 * swipe lands a column too far. Measured in Chrome: a swipe wanting 261 ended at
 * 561, and one wanting the last real column ended on the "+ Add column" tile.
 *
 * Driving it here also means a browser scroll animation is never in flight to
 * blend with a fling, and that a new gesture interrupts the slide by simply not
 * scheduling the next frame.
 *
 * Ease-out cubic, so it decelerates into the column and never overshoots it. At or
 * past `duration` the answer is exactly `to`, which is the property the re-arm
 * depends on — a fraction short leaves the board between two snap points.
 */
export function settleScrollLeft(
  from: number,
  to: number,
  elapsed: number,
  duration: number
): number {
  if (duration <= 0 || elapsed >= duration) {
    return to;
  }
  if (elapsed <= 0) {
    return from;
  }
  const remaining = 1 - elapsed / duration;
  return from + (to - from) * (1 - remaining * remaining * remaining);
}

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
