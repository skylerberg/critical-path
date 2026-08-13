import { nearestSnapIndex, snapScrollLeft, type SnapAlign } from './board-scroll';

/**
 * Where the board's scroll-snap targets park, read off the live scroller.
 *
 * Kept apart from board-scroll.ts, which is pure arithmetic and tested as such.
 * Everything here reads the DOM — `getComputedStyle`, `getBoundingClientRect` —
 * and folding it in would cost that module the property its cheap test depends
 * on.
 */

export function columnSections(scroller: HTMLElement): HTMLElement[] {
  return Array.from(scroller.querySelectorAll<HTMLElement>('section'));
}

// Every snap target, not just the columns: the "+ Add column" tile is one too,
// so leaving it out puts the index off by one whenever it is involved.
export function snapTargets(scroller: HTMLElement): HTMLElement[] {
  return Array.from(scroller.querySelectorAll<HTMLElement>('[data-snap-target]'));
}

/**
 * The `scrollLeft` that parks one snap target, alignment and all.
 *
 * Reading the alignment and scroll padding back off the elements keeps the
 * breakpoints that set them in one place — the class list — rather than
 * duplicating rem values and a `md` cutoff here. That matters more now that the
 * three targets of a phone board do not agree: the first column starts, the last
 * one ends, the rest center. `scroll-snap-align` serializes as `<block>
 * <inline>`, so the last token is the axis this scroller uses; a stylesheet-less
 * environment reports neither, which reads as start.
 */
function snapLeft(scroller: HTMLElement, target: HTMLElement): number {
  const inline = getComputedStyle(target).scrollSnapAlign.split(' ').pop();
  const align: SnapAlign = inline === 'center' || inline === 'end' ? inline : 'start';
  const style = getComputedStyle(scroller);
  return snapScrollLeft(
    scroller.scrollLeft,
    scroller.getBoundingClientRect(),
    target.getBoundingClientRect(),
    align,
    {
      left: parseFloat(style.scrollPaddingLeft) || 0,
      right: parseFloat(style.scrollPaddingRight) || 0,
    }
  );
}

// Which target the board is resting on — the swipe's origin. Compared as scroll
// positions rather than as distances from the middle of the screen, because with
// the ends aligned to the edges the resting target is not the middle one.
export function restingSnapIndex(scroller: HTMLElement): number {
  return nearestSnapIndex(
    scroller.scrollLeft,
    snapTargets(scroller).map((target) => snapLeft(scroller, target))
  );
}

export function slideColumnIntoView(
  scroller: HTMLElement,
  section: HTMLElement,
  smooth: boolean
): void {
  scroller.scrollTo({ left: snapLeft(scroller, section), behavior: smooth ? 'smooth' : 'auto' });
}

/**
 * Where each column parks on a phone. The ends align to the board's edges and
 * everything between centers, so being flush against an edge means you are at
 * that end of the board and nothing else does. Centering the ends instead is
 * what used to cost half a viewport of blank canvas in front of the first column
 * and behind the last. From md up they all start-align, as before.
 *
 * `endColumnIndex` is -1 whenever the "+ Add column" tile is rendered, because
 * that tile is then the board's last snap target and no column ends it. A lone
 * column on a readonly board matches both arms; start wins, which is right —
 * such a board does not scroll.
 */
export function columnSnapAlign(index: number, endColumnIndex: number): string {
  if (index === 0) {
    return 'snap-start';
  }
  return index === endColumnIndex ? 'snap-end' : 'snap-center';
}
