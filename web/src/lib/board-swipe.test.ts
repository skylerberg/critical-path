import { describe, it, expect } from 'vitest';
import { SWIPE_COMMIT_PX, SWIPE_COMMIT_PX_PER_S, swipeTarget } from './board-swipe';

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
