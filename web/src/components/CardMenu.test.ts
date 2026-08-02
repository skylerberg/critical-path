import { fetchMock } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import CardMenu from './CardMenu.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';
import { cardMenu } from '../lib/card-menu.svelte';
import { router } from '../lib/router.svelte';
import { shortcuts } from '../lib/shortcuts.svelte';
import { toasts } from '../lib/toasts.svelte';

const me = { id: 'u-me', name: 'Ada', email: 'ada@example.com', avatar_url: null };

function task(id: string, columnId: string): BoardTask {
  return {
    id,
    column_id: columnId,
    title: id === 't1' ? 'Design cards' : id,
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
  cardMenu.open('t1', 40, 60);
  return render(CardMenu, { projectId: 'p1', canEdit });
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
  board.currentProjectId = 'p1';
  board.project = {
    id: 'p1',
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
  board.tasks = [task('t1', 'c1')];
  router.navigate('/projects/p1', { replace: true });
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
    board.tasks = [task('t1', 'c2')];
    open();
    expect(screen.queryByRole('menuitem', { name: 'Mark done' })).toBeNull();
  });

  it('hands the quick menus the card the row belongs to', async () => {
    open();

    await fireEvent.click(screen.getByRole('menuitem', { name: /Labels/ }));
    expect(shortcuts.labelMenu).toBe('t1');
    expect(cardMenu.taskId).toBeNull();
  });

  it('tells the two blocker directions apart', async () => {
    const { unmount } = open();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Blocked by/ }));
    expect(shortcuts.dependencyMenu).toEqual({ taskId: 't1', direction: 'blocker' });
    unmount();

    shortcuts.reset();
    open();
    await fireEvent.click(screen.getByRole('menuitem', { name: /^Blocks/ }));
    expect(shortcuts.dependencyMenu).toEqual({ taskId: 't1', direction: 'blocked' });
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

    expect(markTaskDone).toHaveBeenCalledWith('t1');
    expect(duplicateTask).toHaveBeenCalledWith('t1');
    expect(archiveTask).toHaveBeenCalledWith('t1');
  });

  it('starts the inline rename instead of opening the card', async () => {
    open();

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit title' }));

    expect(cardMenu.renamingTaskId).toBe('t1');
    expect(cardMenu.taskId).toBeNull();
    expect(router.path).toBe('/projects/p1');
  });

  it('carries the live filters into the card links', () => {
    board.labels = [{ id: 'l1', name: 'art', color: '#ff0000' }];
    board.setFilters({ labelIds: ['l1'], assigneeIds: [], query: 'boss' });
    open();

    for (const name of ['Open', 'Open in new tab']) {
      expect(screen.getByRole('menuitem', { name })).toHaveAttribute(
        'href',
        '/projects/p1/tasks/t1?labels=l1&q=boss'
      );
    }
  });

  it('points at the public path on a public board', () => {
    board.readonly = true;
    open(false);

    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveAttribute(
      'href',
      '/public/projects/p1/tasks/t1'
    );
  });

  it('opens a new tab without hijacking it', () => {
    open();

    const newTab = screen.getByRole('menuitem', { name: 'Open in new tab' });
    expect(newTab).toHaveAttribute('target', '_blank');
    expect(newTab).toHaveAttribute('rel', 'noopener');
    expect(screen.getByRole('menuitem', { name: 'Open' })).not.toHaveAttribute('target');
  });

  it('copies an absolute url and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    open();

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/projects/p1/tasks/t1`);
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
      const card = document.createElement('div');
      card.tabIndex = 0;
      card.dataset.taskId = 't1';
      document.body.append(card);
      open();

      await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

      expect(cardMenu.taskId).toBeNull();
      expect(document.activeElement).toBe(card);
      card.remove();
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
    expect(cardMenu.taskId).toBe('t1');

    await fireEvent.pointerDown(document.body);
    expect(cardMenu.taskId).toBeNull();
  });

  it('closes itself when the card it belongs to goes away', async () => {
    open();

    board.tasks = [];
    await Promise.resolve();

    expect(cardMenu.taskId).toBeNull();
  });

  it('anchors to the pointer, kept clear of the viewport edges', () => {
    cardMenu.open('t1', 40, 60);
    render(CardMenu, { projectId: 'p1', canEdit: true });

    expect(screen.getByRole('menu')).toHaveStyle({ left: '40px', top: '60px' });
  });
});
