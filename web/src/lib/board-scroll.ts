/**
 * One-column-at-a-time horizontal advance for the board scroller during a drag.
 *
 * Why this exists: `svelte-dnd-action` has no option to disable its edge
 * auto-scroller, and that auto-scroller calls `scrollBy()` every animation
 * frame. With `scroll-snap-type: x mandatory` the browser uses *directional*
 * snapping, so each `scrollBy()` jumps a whole column — a touch drag held near
 * the edge rockets across every column. To keep snap during a drag we instead
 * hide the scroller from the library (set `overflow: hidden` while dragging) and
 * drive advancement ourselves, one column per tick.
 *
 * This pure helper computes, given the current viewport positions of the
 * columns and the scroller, the absolute `scrollLeft` that would center the
 * next/previous column — or `null` if there is nowhere left to go. The DOM
 * rect gathering lives in the component; this stays trivially testable.
 *
 * @param columnCenters Viewport-x center of each column, left to right.
 * @param scrollerCenter Viewport-x center of the scroll container.
 * @param scrollLeft Its current `scrollLeft`.
 * @param dir `-1` to advance left, `1` to advance right.
 * @returns The target `scrollLeft`, or `null` if already at the edge.
 */
export function columnAdvanceTarget(
  columnCenters: number[],
  scrollerCenter: number,
  scrollLeft: number,
  dir: -1 | 1
): number | null {
  if (columnCenters.length === 0) {
    return null;
  }
  // The column currently nearest centered is the one we advance *from*.
  let currentIndex = 0;
  let best = Infinity;
  for (let i = 0; i < columnCenters.length; i++) {
    const distance = Math.abs(columnCenters[i] - scrollerCenter);
    if (distance < best) {
      best = distance;
      currentIndex = i;
    }
  }
  const targetIndex = Math.max(0, Math.min(columnCenters.length - 1, currentIndex + dir));
  if (targetIndex === currentIndex) {
    return null;
  }
  // Moving the target column's center onto the scroller center means scrolling
  // by exactly (targetCenter - scrollerCenter), relative to the current offset.
  return scrollLeft + (columnCenters[targetIndex] - scrollerCenter);
}
