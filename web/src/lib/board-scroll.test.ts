import { describe, it, expect } from 'vitest';
import {
  edgeScrollSpeed,
  fitsHorizontally,
  nearestSnapIndex,
  snapScrollLeft,
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

// The board's own gutter, and a scroller with none, since the two arms that read
// the padding read opposite edges of it.
const GUTTER = { left: 12, right: 12 };
const NO_GUTTER = { left: 0, right: 0 };

describe('snapScrollLeft (start-aligned)', () => {
  it('leaves a column already on its snap position alone', () => {
    expect(snapScrollLeft(0, VIEW, { left: 12, right: 300 }, 'start', GUTTER)).toBe(0);
  });

  it('scrolls right to reach a column further along', () => {
    expect(snapScrollLeft(0, VIEW, { left: 612, right: 900 }, 'start', GUTTER)).toBe(600);
  });

  it('scrolls left to reach a column behind', () => {
    expect(snapScrollLeft(600, VIEW, { left: -288, right: 0 }, 'start', GUTTER)).toBe(300);
  });

  it('is relative to where the board is scrolled now', () => {
    expect(snapScrollLeft(900, VIEW, { left: 312, right: 600 }, 'start', GUTTER)).toBe(1200);
  });

  // Landing a gutter short would leave the board between two snap points, and
  // mandatory snap would then round it to whichever is nearer.
  it('accounts for the scroll padding that offsets the snap position', () => {
    const target = { left: 312, right: 600 };
    expect(
      snapScrollLeft(0, VIEW, target, 'start', NO_GUTTER) -
        snapScrollLeft(0, VIEW, target, 'start', GUTTER)
    ).toBe(12);
  });

  // Only the left edge of a start-aligned target is anchored, so the padding on
  // the far side has nothing to say about it.
  it('ignores the padding on the edge it does not align to', () => {
    const target = { left: 312, right: 600 };
    expect(snapScrollLeft(0, VIEW, target, 'start', { left: 12, right: 40 })).toBe(
      snapScrollLeft(0, VIEW, target, 'start', GUTTER)
    );
  });
});

describe('snapScrollLeft (center-aligned)', () => {
  // VIEW is the 390px phone board, so its center is 195 and a centered 288px
  // column spans 51..339 — exactly the resting position of column 1.
  it('leaves a column already centered alone', () => {
    expect(snapScrollLeft(0, VIEW, { left: 51, right: 339 }, 'center', NO_GUTTER)).toBe(0);
  });

  it('scrolls right to center a column further along', () => {
    expect(snapScrollLeft(0, VIEW, { left: 351, right: 639 }, 'center', NO_GUTTER)).toBe(300);
  });

  it('scrolls left to center a column behind', () => {
    expect(snapScrollLeft(300, VIEW, { left: -249, right: 39 }, 'center', NO_GUTTER)).toBe(0);
  });

  // Symmetric scroll padding insets both edges of the snapport, leaving its
  // center exactly where it was — subtracting it here would push every centered
  // column off by a gutter.
  it('ignores the scroll padding, which cancels out on a centered target', () => {
    const target = { left: 351, right: 639 };
    expect(snapScrollLeft(0, VIEW, target, 'center', GUTTER)).toBe(
      snapScrollLeft(0, VIEW, target, 'center', NO_GUTTER)
    );
  });

  // The lg sidebar offsets the board from the viewport origin; centering is
  // measured against the board's own box.
  it('centers against the board, not the origin', () => {
    const offset = { left: 224, right: 1280 };
    expect(snapScrollLeft(0, offset, { left: 608, right: 896 }, 'center', NO_GUTTER)).toBe(0);
  });
});

// The mirror of the start arm, and what lets the board's last target rest against
// the right edge with no half-viewport of canvas behind it to center into.
describe('snapScrollLeft (end-aligned)', () => {
  // Flush against VIEW's right edge, inset by the gutter: 90..378 on a 390 board.
  it('leaves a target already flush against the right edge alone', () => {
    expect(snapScrollLeft(0, VIEW, { left: 90, right: 378 }, 'end', GUTTER)).toBe(0);
  });

  it('scrolls right to bring a target further along flush', () => {
    expect(snapScrollLeft(0, VIEW, { left: 390, right: 678 }, 'end', GUTTER)).toBe(300);
  });

  it('scrolls left to bring a target behind flush', () => {
    expect(snapScrollLeft(300, VIEW, { left: -210, right: 78 }, 'end', GUTTER)).toBe(0);
  });

  // The gutter insets the snapport's right edge, so the target parks a gutter
  // short of the board's own edge — which is a gutter FURTHER along than it would
  // park without one, the opposite sign to the start arm.
  it('accounts for the scroll padding on the edge it aligns to', () => {
    const target = { left: 390, right: 678 };
    expect(
      snapScrollLeft(0, VIEW, target, 'end', GUTTER) -
        snapScrollLeft(0, VIEW, target, 'end', NO_GUTTER)
    ).toBe(12);
  });

  // Only the right edge of an end-aligned target is anchored.
  it('ignores the padding on the edge it does not align to', () => {
    const target = { left: 390, right: 678 };
    expect(snapScrollLeft(0, VIEW, target, 'end', { left: 40, right: 12 })).toBe(
      snapScrollLeft(0, VIEW, target, 'end', GUTTER)
    );
  });
});

// Which target a swipe counts from. The board mixes alignments, so this cannot be
// answered by asking which one is nearest the middle of the screen.
describe('nearestSnapIndex', () => {
  it('names the position the board is parked on', () => {
    expect(nearestSnapIndex(600, [0, 300, 600, 900])).toBe(2);
  });

  it('names the nearer of the two it sits between', () => {
    expect(nearestSnapIndex(170, [0, 300, 600])).toBe(1);
    expect(nearestSnapIndex(130, [0, 300, 600])).toBe(0);
  });

  it('keeps the earlier position on an exact tie', () => {
    expect(nearestSnapIndex(150, [0, 300])).toBe(0);
  });

  it('clamps to the ends rather than running off them', () => {
    expect(nearestSnapIndex(-500, [0, 300, 600])).toBe(0);
    expect(nearestSnapIndex(5000, [0, 300, 600])).toBe(2);
  });

  // A board that has not rendered its columns yet. Index 0 is the only answer a
  // caller can index safely, and it re-resolves the moment there is a target.
  it('answers 0 for a board with no snap targets', () => {
    expect(nearestSnapIndex(400, [])).toBe(0);
  });

  // The first column starts, the rest center: the gap in front of the second
  // position is a gutter short of the pitch behind it, and resting on the first
  // column must still name the first column.
  it('handles the uneven pitch a start-aligned first column leaves', () => {
    const positions = [0, 261, 561, 861];
    expect(nearestSnapIndex(0, positions)).toBe(0);
    expect(nearestSnapIndex(261, positions)).toBe(1);
  });

  // The defining property, and the one no center-distance implementation can
  // satisfy on an uneven list: parked exactly ON a position, the answer is that
  // position's own index, whatever the spacing either side of it. Stating it as a
  // property rather than as cases is what makes it independent of the board's
  // current geometry — the layout that produced these numbers can change without
  // the rule that generated them changing with it.
  //
  // The two lists were measured off the board, but nothing here re-checks that
  // they still describe it: the property holds for ANY list, so a column resized
  // tomorrow leaves these numbers stale and the test green. Read them as a shape,
  // not as a record — uneven at both ends, which is what a center-distance reading
  // cannot handle. `check:layout:real` is what holds the real geometry to account.
  it.each([
    ['390px phone', [0, 261, 561, 861, 1161, 1461, 1761, 2061, 2322]],
    ['740px phone', [0, 86, 386, 686, 986, 1286, 1586, 1886, 2186, 2486, 2786, 3086, 3172]],
  ])('names every position in the %s list from its own scrollLeft', (_label, positions) => {
    positions.forEach((position, index) => {
      expect(nearestSnapIndex(position, positions)).toBe(index);
    });
  });

  // And a pixel either side of a position still names it, so sub-pixel layout
  // never reads as the neighbor.
  it('tolerates a sub-pixel offset from the position it names', () => {
    const positions = [0, 86, 386, 686];
    for (const index of [1, 2, 3]) {
      expect(nearestSnapIndex(positions[index]! - 1, positions)).toBe(index);
      expect(nearestSnapIndex(positions[index]! + 1, positions)).toBe(index);
    }
  });
});
