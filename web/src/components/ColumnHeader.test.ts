import { fetchMock } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ColumnHeader from './ColumnHeader.svelte';
import { board } from '../lib/board.svelte';
import type { BoardColumn, BoardTask } from '../lib/board-types';

const TODO: BoardColumn = {
  id: 'c1',
  name: 'Todo',
  sort_key: 'V0000010001',
  is_done: false,
};
const DONE: BoardColumn = {
  id: 'c2',
  name: 'Done',
  sort_key: 'V0000020001',
  is_done: true,
};

function task(id: string, columnId: string): BoardTask {
  return {
    id,
    column_id: columnId,
    title: id,
    description: null,
    sort_key: 'V0000010001',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  };
}

function renderHeader(column: BoardColumn, readonly = false) {
  const count = board.tasksInColumn(column.id).length;
  return render(ColumnHeader, { column, count, matchCount: null, readonly });
}

async function openMenu(name = 'Todo'): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: `Options for ${name}` }));
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  board.currentProjectId = 'p1';
  board.columns = [TODO, DONE];
  board.tasks = [task('t1', 'c1')];
  vi.restoreAllMocks();
});

describe('ColumnHeader options menu', () => {
  it('offers both bulk actions for a column with cards', async () => {
    renderHeader(TODO);

    expect(screen.queryByRole('menu')).toBeNull();
    await openMenu();

    expect(screen.getByRole('menuitem', { name: 'Move all cards to…' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Archive all cards' })).toBeInTheDocument();
  });

  it('opens the move dialog from the menu', async () => {
    renderHeader(TODO);
    await openMenu();

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Move all cards to…' }));

    expect(screen.getByLabelText('Move cards to')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the archive dialog from the menu', async () => {
    renderHeader(TODO);
    await openMenu();

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Archive all cards' }));

    expect(screen.getByText(/Archive the 1 card in/)).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('duplicates the column from the menu and closes it', async () => {
    const duplicate = vi.spyOn(board, 'duplicateColumn');
    renderHeader(TODO);
    await openMenu();

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate column' }));

    expect(duplicate).toHaveBeenCalledWith('c1');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('toggles the done flag from the menu and keeps it open', async () => {
    const toggle = vi.spyOn(board, 'toggleColumnDone');
    renderHeader(TODO);
    await openMenu();

    const item = screen.getByRole('menuitemcheckbox', { name: 'Mark as done column' });
    expect(item).toHaveAttribute('aria-checked', 'false');

    await fireEvent.click(item);

    expect(toggle).toHaveBeenCalledWith('c1');
    // A toggle is a setting, so the menu stays open to show the state flip.
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('shows the done toggle as checked for a done column', async () => {
    renderHeader(DONE);
    await openMenu('Done');

    expect(screen.getByRole('menuitemcheckbox', { name: 'Mark as done column' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('opens the delete dialog from the menu and closes it', async () => {
    renderHeader(TODO);
    await openMenu();

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete column' }));

    expect(screen.getByRole('dialog', { name: 'Delete column' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers the duplicate action for an empty column too', async () => {
    renderHeader(DONE);
    await openMenu('Done');

    expect(screen.getByRole('menuitem', { name: 'Duplicate column' })).toBeInTheDocument();
  });

  it('hides the move action when there is nowhere to move to', async () => {
    board.columns = [TODO];
    renderHeader(TODO);
    await openMenu();

    expect(screen.queryByRole('menuitem', { name: 'Move all cards to…' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Archive all cards' })).toBeInTheDocument();
  });

  it('offers neither bulk action for an empty column', async () => {
    renderHeader(DONE);
    await openMenu('Done');

    expect(screen.queryByRole('menuitem', { name: 'Move all cards to…' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Archive all cards' })).toBeNull();
  });

  it('opening one column menu closes the other', async () => {
    board.tasks = [task('t1', 'c1'), task('t2', 'c2')];
    renderHeader(TODO);
    renderHeader(DONE);

    await openMenu();
    await openMenu('Done');

    expect(screen.queryAllByRole('menu')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Options for Todo' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('closes on a click outside and on Escape', async () => {
    renderHeader(TODO);

    await openMenu();
    await fireEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    await openMenu();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('stays open while the menu itself is clicked', async () => {
    renderHeader(TODO);
    await openMenu();

    await fireEvent.click(screen.getByRole('menu'));

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('is absent on a read-only board', () => {
    renderHeader(TODO, true);

    expect(screen.queryByRole('button', { name: 'Options for Todo' })).toBeNull();
  });
});

describe('ColumnHeader sort submenu', () => {
  it('lists the sort options in a view opened from Sort by', async () => {
    renderHeader(TODO);
    await openMenu();

    await fireEvent.click(screen.getByRole('menuitem', { name: /Sort by/ }));

    expect(screen.getByRole('menuitem', { name: 'Alphabetically' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Added to column (newest first)' })
    ).toBeInTheDocument();
    // Manual order is the always-on underlying mode, so it is not a sort choice.
    expect(screen.queryByRole('menuitem', { name: 'Manual order' })).toBeNull();
  });

  it('runs a one-shot sort and closes the whole menu', async () => {
    const sortColumn = vi.spyOn(board, 'sortColumn');
    renderHeader(TODO);
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Sort by/ }));

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Created (newest first)' }));

    expect(sortColumn).toHaveBeenCalledWith('c1', 'created-desc');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('returns to the main menu via Back', async () => {
    renderHeader(TODO);
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Sort by/ }));

    await fireEvent.click(screen.getByRole('menuitem', { name: /Sort by/ }));

    // Back hides the sort options and shows the main menu items again.
    expect(screen.queryByRole('menuitem', { name: 'Alphabetically' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Duplicate column' })).toBeInTheDocument();
  });

  it('does not reopen with the sort view already open', async () => {
    renderHeader(TODO);
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Sort by/ }));
    expect(screen.getByRole('menuitem', { name: 'Alphabetically' })).toBeInTheDocument();

    // Close and reopen: the sort-view flag must reset so it starts closed.
    await fireEvent.click(document.body);
    await openMenu();

    expect(screen.queryByRole('menuitem', { name: 'Alphabetically' })).toBeNull();
  });
});

// A column can go away under an open rename — a project switch, a teammate deleting
// it, the board rebuilding — and removing the focused input is not a blur, so
// without a teardown flush nothing would send what was typed.
describe('ColumnHeader rename', () => {
  async function startRename(): Promise<HTMLElement> {
    await fireEvent.click(screen.getByTitle('Rename column'));
    return screen.getByLabelText('Column name');
  }

  it('commits a rename left open when the header unmounts', async () => {
    const rename = vi.spyOn(board, 'renameColumn');
    const { unmount } = renderHeader(TODO);
    await fireEvent.input(await startRename(), { target: { value: 'In progress' } });

    unmount();

    expect(rename).toHaveBeenCalledWith('c1', 'In progress');
  });

  it('still discards a rename cancelled with Escape', async () => {
    const rename = vi.spyOn(board, 'renameColumn');
    const { unmount } = renderHeader(TODO);
    const input = await startRename();
    await fireEvent.input(input, { target: { value: 'Scrapped' } });
    await fireEvent.keyDown(input, { key: 'Escape' });

    unmount();

    expect(rename).not.toHaveBeenCalled();
  });
});
