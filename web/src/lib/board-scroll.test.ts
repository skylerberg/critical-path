import { describe, it, expect } from 'vitest';
import { columnAdvanceTarget } from './board-scroll';

// Self-consistent model: scroller center at viewport-x 195 (390px wide), columns
// spaced 300px apart. Column i's content center is at i*300 + 195, so the
// scrollLeft that centers it is i*300. `viewportCenters(k)` returns each
// column's viewport-x center when column k is the one centered.
const S = 195;
const STEP = 300;
const N = 5;
const snapLeft = (col: number) => col * STEP;
const viewportCenters = (centeredCol: number) =>
  Array.from({ length: N }, (_, i) => (i - centeredCol) * STEP + S);

describe('columnAdvanceTarget', () => {
  it('advances one column to the right', () => {
    expect(columnAdvanceTarget(viewportCenters(0), S, snapLeft(0), 1)).toBe(snapLeft(1));
  });

  it('advances one column to the left', () => {
    expect(columnAdvanceTarget(viewportCenters(2), S, snapLeft(2), -1)).toBe(snapLeft(1));
  });

  it('uses the nearest centered column as the origin when between snaps', () => {
    // Column 1 currently centered; advancing right targets column 2.
    expect(columnAdvanceTarget(viewportCenters(1), S, snapLeft(1), 1)).toBe(snapLeft(2));
  });

  it('returns null when already at the right edge', () => {
    expect(columnAdvanceTarget(viewportCenters(N - 1), S, snapLeft(N - 1), 1)).toBeNull();
  });

  it('returns null when already at the left edge', () => {
    expect(columnAdvanceTarget(viewportCenters(0), S, snapLeft(0), -1)).toBeNull();
  });

  it('clamps the target to the last column instead of overshooting', () => {
    expect(columnAdvanceTarget(viewportCenters(3), S, snapLeft(3), 1)).toBe(snapLeft(4));
  });

  it('returns null for an empty board', () => {
    expect(columnAdvanceTarget([], S, 0, 1)).toBeNull();
  });
});
