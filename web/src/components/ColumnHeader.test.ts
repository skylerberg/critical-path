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
    comment_count: 0,
  };
}

function renderHeader(column: BoardColumn, readonly = false) {
  const count = board.tasksInColumn(column.id).length;
  return render(ColumnHeader, { column, count, matchCount: null, readonly });
}

async function openMenu(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: 'Column options' }));
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
    await openMenu();

    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(screen.getByText('This column has no cards.')).toBeInTheDocument();
  });

  it('is absent on a read-only board', () => {
    renderHeader(TODO, true);

    expect(screen.queryByRole('button', { name: 'Column options' })).toBeNull();
  });
});
