import { describe, expect, it } from 'vitest';
import { columnSnapAlign } from './board-snap';

// Only columnSnapAlign is covered here. Its siblings read getComputedStyle and
// getBoundingClientRect, neither of which jsdom implements for scroll-snap or
// layout — a test of those would assert on zeroes. scripts/check-board-layout*.mjs
// is what exercises them, in a real browser.
describe('columnSnapAlign', () => {
  // -1 is what the board passes whenever the "+ Add column" tile is rendered:
  // that tile is then the last snap target, so no column ends the board.
  const NO_END_COLUMN = -1;

  it('starts the first column against the board’s edge', () => {
    expect(columnSnapAlign(0, NO_END_COLUMN)).toBe('snap-start');
    expect(columnSnapAlign(0, 4)).toBe('snap-start');
  });

  it('centers everything in the middle', () => {
    expect(columnSnapAlign(1, 4)).toBe('snap-center');
    expect(columnSnapAlign(3, 4)).toBe('snap-center');
  });

  it('ends the last column against the other edge, when a column is last', () => {
    expect(columnSnapAlign(4, 4)).toBe('snap-end');
  });

  // Being flush against an edge has to mean "you are at that end of the board".
  // With the add-column tile present the last column is not the end, so centering
  // it is correct.
  it('centers the last column when the add-column tile ends the board', () => {
    expect(columnSnapAlign(4, NO_END_COLUMN)).toBe('snap-center');
  });

  // A lone column on a readonly board matches both arms. Start wins, which is
  // right: such a board does not scroll, and snap-end would park it against the
  // wrong edge.
  it('starts a lone column rather than ending it', () => {
    expect(columnSnapAlign(0, 0)).toBe('snap-start');
  });
});
