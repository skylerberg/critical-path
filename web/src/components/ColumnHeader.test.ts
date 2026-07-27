import { fetchMock } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ColumnHeader from './ColumnHeader.svelte';
import { board } from '../lib/board.svelte';
import type { BoardColumn, BoardTask } from '../lib/board-types';

const TODO: BoardColumn = { id: 'c1', name: 'Todo', position: 1000, is_done: false };
const DONE: BoardColumn = { id: 'c2', name: 'Done', position: 2000, is_done: true };

function task(id: string, columnId: string): BoardTask {
  return {
    id,
    column_id: columnId,
    title: id,
    description: null,
    position: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    due_date: null,
    comment_count: 0,
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

  it('hides the move action when there is nowhere to move to', async () => {
    board.columns = [TODO];
    renderHeader(TODO);
    await openMenu();

    expect(screen.queryByRole('menuitem', { name: 'Move all cards to…' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Archive all cards' })).toBeInTheDocument();
  });

  it('offers neither action for an empty column', async () => {
    renderHeader(DONE);
    await openMenu('Done');

    expect(screen.queryByRole('menuitem', { name: 'Move all cards to…' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Archive all cards' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'This column has no cards.' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
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
