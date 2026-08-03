import '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { cardCursor, focusCardRow } from './card-cursor.svelte';
import { testUuid } from './test-ids';

const A = testUuid('a');
const B = testUuid('b');
const C = testUuid('c');

beforeEach(() => {
  cardCursor.reset();
  document.body.innerHTML = '';
});

describe('cardCursor', () => {
  it('starts at the first row and stops at each end', () => {
    cardCursor.setRows([A, B]);

    expect(cardCursor.move('down')).toBe(true);
    expect(cardCursor.taskId).toBe(A);
    cardCursor.move('down');
    expect(cardCursor.taskId).toBe(B);
    cardCursor.move('down');
    expect(cardCursor.taskId).toBe(B);
    cardCursor.move('up');
    expect(cardCursor.taskId).toBe(A);
    cardCursor.move('up');
    expect(cardCursor.taskId).toBe(A);
  });

  // Both directions start at the top: a screen with no cursor has no "bottom" the
  // user has in mind, and k landing on the last row of a long list is a jump.
  it('takes the first row when the cursor is nowhere, whichever way it is asked', () => {
    cardCursor.setRows([A, B]);

    expect(cardCursor.move('up')).toBe(true);
    expect(cardCursor.taskId).toBe(A);
  });

  it('declines to move with no rows at all, so the key falls through', () => {
    expect(cardCursor.move('down')).toBe(false);
    expect(cardCursor.taskId).toBeNull();
  });

  it('drops a cursor the incoming rows no longer hold', () => {
    cardCursor.setRows([A, B]);
    cardCursor.set(B);

    cardCursor.setRows([A, C]);

    expect(cardCursor.taskId).toBeNull();
  });

  it('keeps a cursor the incoming rows still hold, even reordered', () => {
    cardCursor.setRows([A, B]);
    cardCursor.set(B);

    cardCursor.setRows([B, A]);

    expect(cardCursor.taskId).toBe(B);
  });

  it('moves focus onto the row it lands on', () => {
    const row = document.createElement('a');
    row.href = '/t/a';
    row.dataset.cardRow = A;
    document.body.append(row);
    cardCursor.setRows([A]);

    cardCursor.move('down');

    expect(document.activeElement).toBe(row);
  });

  it('survives a row that is not on screen', () => {
    cardCursor.setRows([A]);

    expect(() => focusCardRow(A)).not.toThrow();
  });
});
