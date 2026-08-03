import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { board } from './board.svelte';
import type { BoardTask } from './board-types';
import { cardMenu } from './card-menu.svelte';
import { selection } from './selection.svelte';
import { session } from './session.svelte';

const LONG_PRESS_MS = 500;

function task(id: string): BoardTask {
  return {
    id,
    column_id: 'c1',
    title: id,
    description: null,
    position: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
  };
}

function press(init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent('pointerdown', {
    pointerType: 'touch',
    isPrimary: true,
    clientX: 100,
    clientY: 100,
    ...init,
  });
}

function moveTo(x: number, y: number): void {
  document.dispatchEvent(
    new PointerEvent('pointermove', { pointerType: 'touch', clientX: x, clientY: y })
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  board.reset();
  cardMenu.reset();
  selection.clear();
  board.tasks = [task('t1')];
  document.body.innerHTML = '';
});

afterEach(() => {
  cardMenu.reset();
  // Lets each test's click-swallowing listener retire; discarding its timer with
  // the fake clock would leave it on the document for the next test.
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('long press', () => {
  it('opens the menu at the pressed point once the hold is long enough', () => {
    cardMenu.pressStart(press(), 't1');
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(cardMenu.taskId).toBe('t1');
    expect(cardMenu.x).toBe(100);
    expect(cardMenu.y).toBe(100);
  });

  it('does not open before the hold is long enough', () => {
    cardMenu.pressStart(press(), 't1');
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);

    expect(cardMenu.taskId).toBeNull();
  });

  // The drag layer lifts the card first, so movement is the only thing that can
  // tell a drag apart from a press being held for the menu.
  it('gives the gesture up to the drag once the pointer moves', () => {
    cardMenu.pressStart(press(), 't1');
    moveTo(140, 100);
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(cardMenu.taskId).toBeNull();
  });

  it('tolerates the jitter of a finger held still', () => {
    cardMenu.pressStart(press(), 't1');
    moveTo(104, 97);
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(cardMenu.taskId).toBe('t1');
  });

  it('drops the press when the finger lifts or the gesture is cancelled', () => {
    for (const type of ['pointerup', 'pointercancel']) {
      cardMenu.pressStart(press(), 't1');
      document.dispatchEvent(new PointerEvent(type, { pointerType: 'touch' }));
      vi.advanceTimersByTime(LONG_PRESS_MS);

      expect(cardMenu.taskId).toBeNull();
    }
  });

  it('leaves the mouse to right-click', () => {
    cardMenu.pressStart(press({ pointerType: 'mouse' }), 't1');
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(cardMenu.taskId).toBeNull();
  });

  it('ignores a second finger', () => {
    cardMenu.pressStart(press({ isPrimary: false }), 't1');
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(cardMenu.taskId).toBeNull();
  });

  it('opens nothing for a card that went away under the finger', () => {
    cardMenu.pressStart(press(), 't1');
    board.tasks = [];
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(cardMenu.taskId).toBeNull();
  });

  it('unwinds the drag the same press already armed', () => {
    const dropped = vi.fn();
    window.addEventListener('touchend', dropped);
    board.dragging = true;
    cardMenu.pressStart(press(), 't1');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    window.removeEventListener('touchend', dropped);

    expect(dropped).toHaveBeenCalledTimes(1);
    expect(cardMenu.taskId).toBe('t1');
  });

  it('leaves the drag alone when the press armed none', () => {
    const dropped = vi.fn();
    window.addEventListener('touchend', dropped);
    cardMenu.pressStart(press(), 't1');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    window.removeEventListener('touchend', dropped);

    expect(dropped).not.toHaveBeenCalled();
  });

  it('swallows the click the press turns into, so the card does not open behind the menu', () => {
    const card = document.createElement('a');
    document.body.append(card);
    const followed = vi.fn();
    card.addEventListener('click', followed);

    cardMenu.pressStart(press(), 't1');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(followed).not.toHaveBeenCalled();
  });

  it('lets a tap on the menu itself through', () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.append(item);
    document.body.append(menu);
    const activated = vi.fn();
    item.addEventListener('click', activated);

    cardMenu.pressStart(press(), 't1');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(activated).toHaveBeenCalled();
  });

  // The drag teardown detaches the pressed card before the finger lifts, so the
  // click this was armed for usually never arrives — and the next tap must not
  // be the one it eats instead.
  it('stops swallowing clicks once another gesture starts', () => {
    const card = document.createElement('a');
    document.body.append(card);
    const followed = vi.fn();
    card.addEventListener('click', followed);

    cardMenu.pressStart(press(), 't1');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    document.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }));
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(followed).toHaveBeenCalled();
  });

  it('stops swallowing clicks once the press is well behind us', () => {
    const card = document.createElement('a');
    document.body.append(card);
    const followed = vi.fn();
    card.addEventListener('click', followed);

    cardMenu.pressStart(press(), 't1');
    vi.advanceTimersByTime(LONG_PRESS_MS + 1000);
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(followed).toHaveBeenCalled();
  });
});

describe('open and close', () => {
  it('returns focus to the card only when asked', () => {
    const card = document.createElement('div');
    card.tabIndex = 0;
    card.dataset.taskId = 't1';
    document.body.append(card);

    cardMenu.open('t1', 10, 20);
    cardMenu.close();
    expect(document.activeElement).not.toBe(card);

    cardMenu.open('t1', 10, 20);
    cardMenu.close({ restoreFocus: true });
    expect(document.activeElement).toBe(card);
  });

  it('survives a card whose element is no longer on the board', () => {
    cardMenu.open('gone', 10, 20);

    expect(() => cardMenu.close({ restoreFocus: true })).not.toThrow();
    expect(cardMenu.taskId).toBeNull();
  });

  it('closes itself when a row starts the inline rename', () => {
    cardMenu.open('t1', 0, 0);

    cardMenu.rename('t1');

    expect(cardMenu.renamingTaskId).toBe('t1');
    expect(cardMenu.taskId).toBeNull();
  });

  // The blur the menu's own focus causes is what saves it, so cancelling it here
  // would throw the user's typing away.
  it('leaves a rename in flight for the blur to commit', () => {
    cardMenu.rename('t1');

    cardMenu.open('t1', 0, 0);

    expect(cardMenu.renamingTaskId).toBe('t1');
  });

  it('selects the card the menu was opened on', () => {
    cardMenu.open('t1', 0, 0);

    expect(selection.cursorTaskId).toBe('t1');
  });

  describe('with a selection standing', () => {
    beforeEach(() => {
      session.user = {
        id: 'u-me',
        name: 'Ada',
        email: 'ada@example.com',
        avatar_url: null,
        email_verified: false,
      };
      board.project = {
        id: 'p1',
        name: 'Game',
        description: '',
        archived_at: null,
        created_by: 'u-me',
        member_ids: [],
        members: [],
        is_public: false,
        color: null,
        created_at: '2026-01-01T00:00:00Z',
      };
      board.columns = [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }];
      board.tasks = [task('t1'), { ...task('t2'), position: 2000 }];
    });

    afterEach(() => {
      session.user = null;
    });

    it('keeps a set the right-click lands inside', () => {
      selection.toggle('t1');
      selection.toggle('t2');

      cardMenu.open('t2', 0, 0);

      expect(selection.selectedIds).toEqual(['t1', 't2']);
    });

    it('collapses a set the right-click lands outside', () => {
      selection.toggle('t1');

      cardMenu.open('t2', 0, 0);

      expect(selection.selectedIds).toEqual([]);
      expect(selection.cursorTaskId).toBe('t2');
    });
  });
});
