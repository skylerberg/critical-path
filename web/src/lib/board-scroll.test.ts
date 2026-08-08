import { describe, it, expect } from 'vitest';
import {
  edgeScrollSpeed,
  fitsHorizontally,
  MOMENTUM_WINDOW_MS,
  overshootTarget,
  snapScrollLeft,
  verticalRevealDelta,
} from './board-scroll';

// 390px-wide board, 64px edge band, 400px/s top speed.
const L = 0;
const R = 390;
const ZONE = 64;
const MAX = 400;

describe('edgeScrollSpeed', () => {
  it('is 0 in the middle of the board', () => {
    expect(edgeScrollSpeed(195, L, R, ZONE, MAX)).toBe(0);
  });

  it('is 0 at the inner edge of the band', () => {
    expect(edgeScrollSpeed(L + ZONE, L, R, ZONE, MAX)).toBe(0); // 64 from left
    expect(edgeScrollSpeed(R - ZONE, L, R, ZONE, MAX)).toBe(0); // 64 from right
  });

  it('hits full speed at the very edge', () => {
    expect(edgeScrollSpeed(L, L, R, ZONE, MAX)).toBe(-MAX); // left edge -> scroll left
    expect(edgeScrollSpeed(R, L, R, ZONE, MAX)).toBe(MAX); // right edge -> scroll right
  });

  it('scales linearly with depth into the band', () => {
    expect(edgeScrollSpeed(L + ZONE / 2, L, R, ZONE, MAX)).toBe(-MAX / 2); // halfway into left band
    expect(edgeScrollSpeed(R - ZONE / 2, L, R, ZONE, MAX)).toBe(MAX / 2); // halfway into right band
  });

  it('clamps to full speed past the edge', () => {
    expect(edgeScrollSpeed(L - 20, L, R, ZONE, MAX)).toBe(-MAX); // beyond left edge
    expect(edgeScrollSpeed(R + 20, L, R, ZONE, MAX)).toBe(MAX); // beyond right edge
  });
});

// A 390px board scrolled to the origin, gutter 12px, columns 288px wide.
const VIEW = { left: 0, right: 390 };

describe('fitsHorizontally', () => {
  it('accepts a column comfortably inside the board', () => {
    expect(fitsHorizontally(VIEW, { left: 12, right: 300 })).toBe(true);
  });

  it('accepts a column flush with both edges', () => {
    expect(fitsHorizontally(VIEW, { left: 0, right: 390 })).toBe(true);
  });

  it('tolerates a sub-pixel overhang', () => {
    expect(fitsHorizontally(VIEW, { left: -0.4, right: 390.4 })).toBe(true);
  });

  it('rejects a column clipped by the right edge', () => {
    expect(fitsHorizontally(VIEW, { left: 200, right: 488 })).toBe(false);
  });

  it('rejects a column clipped by the left edge', () => {
    expect(fitsHorizontally(VIEW, { left: -50, right: 238 })).toBe(false);
  });

  it('rejects a column wider than the board', () => {
    expect(fitsHorizontally(VIEW, { left: -10, right: 500 })).toBe(false);
  });

  // The board is not always flush with the viewport: the lg sidebar offsets it.
  it('measures against the board, not the origin', () => {
    const offset = { left: 224, right: 1280 };
    expect(fitsHorizontally(offset, { left: 300, right: 588 })).toBe(true);
    expect(fitsHorizontally(offset, { left: 100, right: 388 })).toBe(false);
  });
});

describe('snapScrollLeft (start-aligned)', () => {
  it('leaves a column already on its snap position alone', () => {
    expect(snapScrollLeft(0, VIEW, { left: 12, right: 300 }, 'start', 12)).toBe(0);
  });

  it('scrolls right to reach a column further along', () => {
    expect(snapScrollLeft(0, VIEW, { left: 612, right: 900 }, 'start', 12)).toBe(600);
  });

  it('scrolls left to reach a column behind', () => {
    expect(snapScrollLeft(600, VIEW, { left: -288, right: 0 }, 'start', 12)).toBe(300);
  });

  it('is relative to where the board is scrolled now', () => {
    expect(snapScrollLeft(900, VIEW, { left: 312, right: 600 }, 'start', 12)).toBe(1200);
  });

  // Landing a gutter short would leave the board between two snap points, and
  // mandatory snap would then round it to whichever is nearer.
  it('accounts for the scroll padding that offsets the snap position', () => {
    const target = { left: 312, right: 600 };
    expect(
      snapScrollLeft(0, VIEW, target, 'start', 0) - snapScrollLeft(0, VIEW, target, 'start', 12)
    ).toBe(12);
  });
});

describe('snapScrollLeft (center-aligned)', () => {
  // VIEW is the 390px phone board, so its center is 195 and a centered 288px
  // column spans 51..339 — exactly the resting position of column 1.
  it('leaves a column already centered alone', () => {
    expect(snapScrollLeft(0, VIEW, { left: 51, right: 339 }, 'center', 0)).toBe(0);
  });

  it('scrolls right to center a column further along', () => {
    expect(snapScrollLeft(0, VIEW, { left: 351, right: 639 }, 'center', 0)).toBe(300);
  });

  it('scrolls left to center a column behind', () => {
    expect(snapScrollLeft(300, VIEW, { left: -249, right: 39 }, 'center', 0)).toBe(0);
  });

  // Symmetric scroll padding insets both edges of the snapport, leaving its
  // center exactly where it was — subtracting it here would push every centered
  // column off by a gutter.
  it('ignores the scroll padding, which cancels out on a centered target', () => {
    const target = { left: 351, right: 639 };
    expect(snapScrollLeft(0, VIEW, target, 'center', 12)).toBe(
      snapScrollLeft(0, VIEW, target, 'center', 0)
    );
  });

  // The lg sidebar offsets the board from the viewport origin; centering is
  // measured against the board's own box.
  it('centers against the board, not the origin', () => {
    const offset = { left: 224, right: 1280 };
    expect(snapScrollLeft(0, offset, { left: 608, right: 896 }, 'center', 0)).toBe(0);
  });
});

// Every guard here exists to make the fallback refuse. It has no true positives on
// any engine that also has `scrollend` — Safari honored scroll-snap-stop from 15,
// and only got scrollend in 26.2 — so refusing costs nothing and every correction
// it makes on a scroll it did not fully witness is a false positive.
describe('overshootTarget', () => {
  const SOON = 100;

  it('pulls a fling that sailed past several back to one column', () => {
    expect(overshootTarget(0, 0, 3, SOON)).toBe(1);
  });

  it('pulls one that sailed backwards back to one column', () => {
    expect(overshootTarget(5, 5, 2, SOON)).toBe(4);
  });

  it('leaves a swipe the browser already capped alone', () => {
    expect(overshootTarget(0, 0, 1, SOON)).toBeNull();
    expect(overshootTarget(3, 3, 3, SOON)).toBeNull();
  });

  // A drag that crossed a column carried the board there under the finger; only
  // travel that came purely from momentum is the bug being compensated for.
  it('leaves a deliberate drag across several columns alone', () => {
    expect(overshootTarget(0, 2, 3, SOON)).toBeNull();
  });

  // The iPhone double-swipe: the second gesture's drag and momentum push the
  // settle past one momentum run, whether or not iOS reported its touchstart.
  it('leaves a settle that arrives after the momentum window alone', () => {
    expect(overshootTarget(0, 0, 3, MOMENTUM_WINDOW_MS + 1)).toBeNull();
    expect(overshootTarget(0, 0, 3, MOMENTUM_WINDOW_MS)).toBe(1);
  });
});

describe('verticalRevealDelta', () => {
  const view = { top: 0, bottom: 400 };

  it('is 0 for a target already inside the view', () => {
    expect(verticalRevealDelta(view, { top: 100, bottom: 160 })).toBe(0);
  });

  it('scrolls down the least needed to show a target below the fold', () => {
    expect(verticalRevealDelta(view, { top: 380, bottom: 440 })).toBe(40);
  });

  it('scrolls up the least needed to show a target above the fold', () => {
    expect(verticalRevealDelta(view, { top: -30, bottom: 30 })).toBe(-30);
  });

  it('aligns a target taller than the view to its top', () => {
    expect(verticalRevealDelta(view, { top: 50, bottom: 900 })).toBe(50);
  });
});
