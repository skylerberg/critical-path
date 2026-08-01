import { describe, it, expect } from 'vitest';
import { edgeScrollSpeed } from './board-scroll';

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
