import { fetchMock } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import CardMenu from './CardMenu.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';
import { cardMenu } from '../lib/card-menu.svelte';
import { router } from '../lib/router.svelte';
import { publicTaskHref, projectHref, taskHref } from '../lib/short-links';
import { shortcuts } from '../lib/shortcuts.svelte';
import { testUuid } from '../lib/test-ids';
import { toasts } from '../lib/toasts.svelte';

const me = { id: 'u-me', name: 'Ada', email: 'ada@example.com', avatar_url: null };
const PROJECT_ID = testUuid('p1');
const TASK_ID = testUuid('t1');
const TASK_TITLE = 'Design cards';
const BOARD_PATH = projectHref(PROJECT_ID, 'Game');

function task(columnId: string): BoardTask {
  return {
    id: TASK_ID,
    column_id: columnId,
    title: TASK_TITLE,
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
  };
}

function open(canEdit = true) {
  cardMenu.open(TASK_ID, 40, 60);
  return render(CardMenu, { projectId: PROJECT_ID, canEdit });
}

// The focusable wrapper the board draws around every card, which is what the menu
// hands focus back to.
function cardWrapper(): HTMLElement {
  const element = document.createElement('div');
  element.tabIndex = 0;
  element.dataset.taskId = TASK_ID;
  document.body.append(element);
  onTestFinished(() => element.remove());
  return element;
}

// A row the app deliberately leaves to the browser is one jsdom tries to follow
// for real. Bubble phase, so the router still sees the click untouched.
function swallowTheNavigation(): void {
  document.addEventListener('click', (event) => event.preventDefault(), { once: true });
}

function itemLabels(): string[] {
  return screen
    .getAllByRole('menuitem')
    .map((item) => item.querySelector('span')?.textContent ?? '');
}

function keysShown(name: string): string[] {
  return [...screen.getByRole('menuitem', { name }).querySelectorAll('kbd')].map(
    (key) => key.textContent?.trim() ?? ''
  );
}

function hintFor(name: string): string | null {
  return screen.getByRole('menuitem', { name }).getAttribute('aria-keyshortcuts');
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  board.reset();
  shortcuts.reset();
  cardMenu.reset();
  toasts.toasts = [];
  board.currentProjectId = PROJECT_ID;
  board.project = {
    id: PROJECT_ID,
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: me.id,
    member_ids: [],
    members: [],
    is_public: false,
    created_at: '2026-01-01T00:00:00Z',
  };
  board.columns = [
    { id: 'c1', name: 'Todo', position: 1000, is_done: false },
    { id: 'c2', name: 'Done', position: 2000, is_done: true },
  ];
  board.tasks = [task('c1')];
  router.navigate(BOARD_PATH, { replace: true });
});

afterEach(() => {
  cardMenu.reset();
  vi.restoreAllMocks();
});

describe('CardMenu', () => {
  it('names the card it acts on and offers every card action', () => {
    open();

    expect(screen.getByRole('menu')).toHaveAccessibleName('Actions for Design cards');
    expect(itemLabels()).toEqual([
      'Edit title',
      'Labels…',
      'Assignees…',
      'Blocked by…',
      'Blocks…',
      'Move to…',
      'Mark done',
      'Duplicate',
      'Archive',
      'Open',
      'Open in new tab',
      'Copy link',
    ]);
  });

  // The rendered hint and the one a screen reader reads have to be the same key,
  // and both come from the table the keymap itself is tested against.
  it('shows each row the key that really runs it', () => {
    open();

    expect(keysShown('Blocks…')).toEqual(['Shift+B']);
    expect(keysShown('Duplicate')).toEqual(['Shift+D']);
    expect(keysShown('Open')).toEqual(['Enter', 'o']);
    expect(keysShown('Archive')).toEqual([]);
    expect(hintFor('Labels…')).toBe('l');
    expect(hintFor('Blocks…')).toBe('Shift+B');
    expect(hintFor('Open')).toBe('Enter o');
    expect(hintFor('Archive')).toBeNull();
  });

  // Greying a row out would still leave it in the tab order for a viewer to land on.
  it('leaves a viewer only what a viewer can do', () => {
    open(false);

    expect(itemLabels()).toEqual(['Open', 'Open in new tab', 'Copy link']);
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('drops Mark done where it would do nothing', () => {
    board.columns = [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }];
    const { unmount } = open();
    expect(screen.queryByRole('menuitem', { name: 'Mark done' })).toBeNull();
    unmount();

    board.columns = [{ id: 'c2', name: 'Done', position: 2000, is_done: true }];
    board.tasks = [task('c2')];
    open();
    expect(screen.queryByRole('menuitem', { name: 'Mark done' })).toBeNull();
  });

  it('hands the quick menus the card the row belongs to', async () => {
    open();

    await fireEvent.click(screen.getByRole('menuitem', { name: /Labels/ }));
    expect(shortcuts.labelMenu).toBe(TASK_ID);
    expect(cardMenu.taskId).toBeNull();
  });

  it('tells the two blocker directions apart', async () => {
    const { unmount } = open();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Blocked by/ }));
    expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_ID, direction: 'blocker' });
    unmount();

    shortcuts.reset();
    open();
    await fireEvent.click(screen.getByRole('menuitem', { name: /^Blocks/ }));
    expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_ID, direction: 'blocked' });
  });

  it('runs the board actions on the card', async () => {
    const markTaskDone = vi.spyOn(board, 'markTaskDone').mockReturnValue(true);
    const duplicateTask = vi.spyOn(board, 'duplicateTask').mockResolvedValue('t2');
    const archiveTask = vi.spyOn(board, 'archiveTask').mockResolvedValue();

    const first = open();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Mark done/ }));
    first.unmount();

    const second = open();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Duplicate/ }));
    second.unmount();

    open();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));

    expect(markTaskDone).toHaveBeenCalledWith(TASK_ID);
    expect(duplicateTask).toHaveBeenCalledWith(TASK_ID);
    expect(archiveTask).toHaveBeenCalledWith(TASK_ID);
  });

  it('starts the inline rename instead of opening the card', async () => {
    open();

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit title' }));

    expect(cardMenu.renamingTaskId).toBe(TASK_ID);
    expect(cardMenu.taskId).toBeNull();
    expect(router.path).toBe(BOARD_PATH);
  });

  it('carries the live filters into the card links', () => {
    board.labels = [{ id: 'l1', name: 'art', color: '#ff0000' }];
    board.setFilters({ labelIds: ['l1'], assigneeIds: [], query: 'boss' });
    open();

    for (const name of ['Open', 'Open in new tab']) {
      expect(screen.getByRole('menuitem', { name })).toHaveAttribute(
        'href',
        `${taskHref(TASK_ID, TASK_TITLE)}?labels=l1&q=boss`
      );
    }
  });

  it('points at the public path on a public board', () => {
    board.readonly = true;
    board.labels = [{ id: 'l1', name: 'art', color: '#ff0000' }];
    board.setFilters({ labelIds: ['l1'], assigneeIds: [], query: 'boss' });
    open(false);

    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveAttribute(
      'href',
      publicTaskHref(PROJECT_ID, TASK_ID)
    );
  });

  it('opens a new tab without hijacking it', () => {
    open();

    const newTab = screen.getByRole('menuitem', { name: 'Open in new tab' });
    expect(newTab).toHaveAttribute('target', '_blank');
    expect(newTab).toHaveAttribute('rel', 'noopener');
    expect(screen.getByRole('menuitem', { name: 'Open' })).not.toHaveAttribute('target');
  });

  // A copied link goes to someone else, who should not inherit the sharer's narrowing.
  it('copies an absolute url stripped of the filters, and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    board.labels = [{ id: 'l1', name: 'art', color: '#ff0000' }];
    board.setFilters({ labelIds: ['l1'], assigneeIds: [], query: 'boss' });
    open();

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}${taskHref(TASK_ID, TASK_TITLE)}`
    );
    expect(toasts.toasts.at(-1)?.message).toBe('Link copied');
    vi.unstubAllGlobals();
  });

  it('says so when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    open();

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));

    expect(toasts.toasts.at(-1)).toMatchObject({ message: 'Could not copy the link' });
    vi.unstubAllGlobals();
  });

  describe('keyboard', () => {
    it('lands on the first row', () => {
      open();

      expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
    });

    it('walks the rows with the arrows, wrapping at both ends', async () => {
      open();
      const items = screen.getAllByRole('menuitem');
      const menu = screen.getByRole('menu');

      await fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(items[1]);

      await fireEvent.keyDown(menu, { key: 'ArrowUp' });
      await fireEvent.keyDown(menu, { key: 'ArrowUp' });
      expect(document.activeElement).toBe(items.at(-1));

      await fireEvent.keyDown(menu, { key: 'Home' });
      expect(document.activeElement).toBe(items[0]);

      await fireEvent.keyDown(menu, { key: 'End' });
      expect(document.activeElement).toBe(items.at(-1));
    });

    it('closes on Escape and puts focus back on the card', async () => {
      const card = cardWrapper();
      open();

      await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

      expect(cardMenu.taskId).toBeNull();
      expect(document.activeElement).toBe(card);
    });

    // An anchor has no Space activation of its own, and for a viewer two of the
    // three rows there are anchors.
    it('activates the focused row on Space', async () => {
      open();
      const link = screen.getByRole('menuitem', { name: 'Open' });
      link.focus();

      await fireEvent.keyDown(link, { key: ' ' });

      expect(router.path).toBe(taskHref(TASK_ID, TASK_TITLE));
      expect(cardMenu.taskId).toBeNull();
    });

    it('activates a button row on Space too', async () => {
      open();
      const rename = screen.getByRole('menuitem', { name: 'Edit title' });
      rename.focus();

      await fireEvent.keyDown(rename, { key: ' ' });

      expect(cardMenu.renamingTaskId).toBe(TASK_ID);
    });

    // aria-keyshortcuts promises the key activates the row, not merely that the
    // key exists somewhere else in the app.
    it('runs the row whose advertised key was pressed', async () => {
      open();
      const menu = screen.getByRole('menu');

      await fireEvent.keyDown(menu, { key: 'B', shiftKey: true });

      expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_ID, direction: 'blocked' });
      expect(cardMenu.taskId).toBeNull();
    });

    it('tells a shifted advertised key from its unshifted one', async () => {
      open();

      await fireEvent.keyDown(screen.getByRole('menu'), { key: 'b' });

      expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_ID, direction: 'blocker' });
    });

    // Enter belongs to whichever row has focus, so the row that advertises it
    // must not take it from the rest.
    it('leaves Enter to the focused row', async () => {
      open();
      screen.getByRole('menuitem', { name: 'Archive' }).focus();

      const event = await fireEvent.keyDown(screen.getByRole('menu'), {
        key: 'Enter',
        cancelable: true,
      });

      expect(event).toBe(true);
      expect(router.path).toBe(BOARD_PATH);
    });

    // Closing without swallowing the key is what keeps focus out of a trap.
    it('closes on Tab and lets the key through', async () => {
      open();

      const event = await fireEvent.keyDown(screen.getByRole('menu'), {
        key: 'Tab',
        cancelable: true,
      });

      expect(cardMenu.taskId).toBeNull();
      expect(event).toBe(true);
    });
  });

  it('closes when a press lands outside it', async () => {
    open();

    await fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Edit title' }));
    expect(cardMenu.taskId).toBe(TASK_ID);

    await fireEvent.pointerDown(document.body);
    expect(cardMenu.taskId).toBeNull();
  });

  it('closes itself when the card it belongs to goes away', async () => {
    open();

    board.tasks = [];
    await Promise.resolve();

    expect(cardMenu.taskId).toBeNull();
  });

  it('anchors to the pointer', () => {
    cardMenu.open(TASK_ID, 40, 60);
    render(CardMenu, { projectId: PROJECT_ID, canEdit: true });

    expect(screen.getByRole('menu')).toHaveStyle({ left: '40px', top: '60px' });
  });

  // jsdom lays nothing out, so the menu has to be given a size for the clamp to
  // have anything to work against.
  it('keeps a menu opened at the edge of the viewport on screen', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 256, 400)
    );

    cardMenu.open(TASK_ID, 1000, 700);
    const { unmount } = render(CardMenu, { projectId: PROJECT_ID, canEdit: true });
    // 1024x768 less the menu and an 8px margin.
    expect(screen.getByRole('menu')).toHaveStyle({ left: '760px', top: '360px' });
    unmount();

    cardMenu.open(TASK_ID, 2, 1);
    render(CardMenu, { projectId: PROJECT_ID, canEdit: true });
    expect(screen.getByRole('menu')).toHaveStyle({ left: '8px', top: '8px' });
  });

  describe('leaving the menu', () => {
    it('puts focus back on the card when the row leaves the user on the board', async () => {
      const card = cardWrapper();
      open();

      await fireEvent.click(screen.getByRole('menuitem', { name: /Labels/ }));

      expect(document.activeElement).toBe(card);
    });

    it('leaves focus alone when the row navigates to the card', async () => {
      const card = cardWrapper();
      open();

      await fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));

      expect(router.path).toBe(taskHref(TASK_ID, TASK_TITLE));
      expect(document.activeElement).not.toBe(card);
    });

    // A modifier-click loads the card in a tab the user is not looking at, so
    // they are still on the board and still need somewhere to be.
    it('puts focus back on the card when a modifier-click opens the link elsewhere', async () => {
      const card = cardWrapper();
      open();
      swallowTheNavigation();

      await fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }), { metaKey: true });

      expect(router.path).toBe(BOARD_PATH);
      expect(cardMenu.taskId).toBeNull();
      expect(document.activeElement).toBe(card);
    });

    it('puts focus back on the card when a new tab is asked for', async () => {
      const card = cardWrapper();
      open();
      swallowTheNavigation();

      await fireEvent.click(screen.getByRole('menuitem', { name: 'Open in new tab' }));

      expect(document.activeElement).toBe(card);
    });

    // The middle button fires auxclick, never click, so nothing else here would
    // take the menu off the board it is floating over.
    it('closes when a middle-click sends the card to a background tab', async () => {
      open();

      await fireEvent(
        screen.getByRole('menuitem', { name: 'Open' }),
        new MouseEvent('auxclick', { bubbles: true, button: 1 })
      );

      expect(cardMenu.taskId).toBeNull();
    });
  });
});
