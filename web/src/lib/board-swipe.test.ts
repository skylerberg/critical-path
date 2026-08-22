import { describe, it, expect } from 'vitest';
import {
  settleScrollLeft,
  SWIPE_COMMIT_PX,
  SWIPE_COMMIT_PX_PER_S,
  swipeTarget,
} from './board-swipe';

// The one-column cap is this function's return type in practice: origin, origin-1
// or origin+1 and nothing else is expressible. Drag length and engine momentum
// cannot widen it, which is the whole reason the decision moved here from a
// post-hoc correction.
describe('swipeTarget', () => {
  const SLOW = 0;
  const LAST = 5;

  it('advances one column when the finger drags left past the threshold', () => {
    expect(swipeTarget(2, -SWIPE_COMMIT_PX, SLOW, LAST)).toBe(3);
  });

  it('goes back one column when the finger drags right past the threshold', () => {
    expect(swipeTarget(2, SWIPE_COMMIT_PX, SLOW, LAST)).toBe(1);
  });

  // The symptom this whole change exists for: a drag long enough to cross two
  // columns still lands on the next one.
  it('advances only one column however far the finger dragged', () => {
    expect(swipeTarget(0, -2000, SLOW, LAST)).toBe(1);
    expect(swipeTarget(5, 2000, SLOW, LAST)).toBe(4);
  });

  it('stays put for a drag too short to commit', () => {
    expect(swipeTarget(2, -(SWIPE_COMMIT_PX - 1), SLOW, LAST)).toBe(2);
  });

  // A quick flick barely travels, and must still page.
  it('commits a short flick on velocity alone', () => {
    expect(swipeTarget(2, -4, -SWIPE_COMMIT_PX_PER_S, LAST)).toBe(3);
    expect(swipeTarget(2, 4, SWIPE_COMMIT_PX_PER_S, LAST)).toBe(1);
  });

  it('stays put at the ends rather than running off them', () => {
    expect(swipeTarget(0, 2000, SLOW, LAST)).toBe(0);
    expect(swipeTarget(LAST, -2000, SLOW, LAST)).toBe(LAST);
  });

  it('stays put when the finger did not move at all', () => {
    expect(swipeTarget(2, 0, SWIPE_COMMIT_PX_PER_S, LAST)).toBe(2);
  });
});

// The board runs the closing slide itself, so this is the whole of its motion.
// The property that matters most is the last one: mandatory snap may only be
// re-armed once the board is EXACTLY on the position, and "exactly" is this
// function's job — a fraction short leaves the board between two snap points for
// the browser to resolve, which is the column-too-far the slide exists to avoid.
describe('settleScrollLeft', () => {
  const FROM = 64;
  const TO = 364;
  const MS = 260;

  it('starts where the finger left the board', () => {
    expect(settleScrollLeft(FROM, TO, 0, MS)).toBe(FROM);
  });

  it('lands exactly on the position, and stays there', () => {
    expect(settleScrollLeft(FROM, TO, MS, MS)).toBe(TO);
    expect(settleScrollLeft(FROM, TO, MS * 4, MS)).toBe(TO);
  });

  // Reduced motion asks for no animation at all, and a zero duration must not
  // divide by itself on the way to answering that.
  it('is already there when there is no duration to animate over', () => {
    expect(settleScrollLeft(FROM, TO, 0, 0)).toBe(TO);
  });

  it('decelerates: more than half the distance is covered in the first half', () => {
    const half = settleScrollLeft(FROM, TO, MS / 2, MS);
    expect(half).toBeGreaterThan((FROM + TO) / 2);
    expect(half).toBeLessThan(TO);
  });

  it('advances monotonically and never overshoots, either way round', () => {
    for (const [from, to] of [
      [FROM, TO],
      [TO, FROM],
    ] as const) {
      let previous: number = from;
      for (let elapsed = 0; elapsed <= MS; elapsed += 13) {
        const position = settleScrollLeft(from, to, elapsed, MS);
        expect(Math.abs(position - from)).toBeGreaterThanOrEqual(Math.abs(previous - from));
        expect(Math.abs(position - from)).toBeLessThanOrEqual(Math.abs(to - from));
        previous = position;
      }
    }
  });
});
