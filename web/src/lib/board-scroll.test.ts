import { describe, it, expect } from 'vitest';
import { edgeScrollSpeed, fitsHorizontally, snapScrollLeft } from './board-scroll';

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

describe('snapScrollLeft', () => {
  it('leaves a column already on its snap position alone', () => {
    expect(snapScrollLeft(0, VIEW, { left: 12, right: 300 }, 12)).toBe(0);
  });

  it('scrolls right to reach a column further along', () => {
    expect(snapScrollLeft(0, VIEW, { left: 612, right: 900 }, 12)).toBe(600);
  });

  it('scrolls left to reach a column behind', () => {
    expect(snapScrollLeft(600, VIEW, { left: -288, right: 0 }, 12)).toBe(300);
  });

  it('is relative to where the board is scrolled now', () => {
    expect(snapScrollLeft(900, VIEW, { left: 312, right: 600 }, 12)).toBe(1200);
  });

  // Landing a gutter short would leave the board between two snap points, and
  // mandatory snap would then round it to whichever is nearer.
  it('accounts for the scroll padding that offsets the snap position', () => {
    const target = { left: 312, right: 600 };
    expect(snapScrollLeft(0, VIEW, target, 0) - snapScrollLeft(0, VIEW, target, 12)).toBe(12);
  });
});
