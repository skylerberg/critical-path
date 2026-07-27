import { fetchMock } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ColumnArchiveTasksDialog from './ColumnArchiveTasksDialog.svelte';
import { board } from '../lib/board.svelte';
import type { BoardColumn, BoardTask } from '../lib/board-types';

const TODO: BoardColumn = { id: 'c1', name: 'Todo', position: 1000, is_done: false };
const DONE: BoardColumn = { id: 'c2', name: 'Done', position: 2000, is_done: true };

function task(id: string, columnId: string, blockerIds: string[] = []): BoardTask {
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
    blocker_ids: blockerIds,
    image_count: 0,
    comment_count: 0,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  board.currentProjectId = 'p1';
  board.columns = [TODO, DONE];
  vi.restoreAllMocks();
});

describe('ColumnArchiveTasksDialog', () => {
  it('shows the card count and no dependency warning when nothing depends on them', () => {
    board.tasks = [task('d1', 'c2'), task('d2', 'c2'), task('t1', 'c1')];

    render(ColumnArchiveTasksDialog, { column: DONE, open: true, onclose: () => {} });

    expect(screen.getByText(/Archive the 2 cards in/)).toBeInTheDocument();
    expect(screen.queryByText(/lose a dependency/)).toBeNull();
  });

  it('counts the cards elsewhere that will lose a dependency', () => {
    board.tasks = [
      task('d1', 'c2'),
      task('d2', 'c2'),
      task('t1', 'c1', ['d1']),
      task('t2', 'c1', ['d2']),
      task('t3', 'c1'),
    ];

    render(ColumnArchiveTasksDialog, { column: DONE, open: true, onclose: () => {} });

    expect(screen.getByText(/2 cards elsewhere on the board will lose a dependency/)).toBeVisible();
  });

  it('counts a card blocked by two of the archived cards only once', () => {
    board.tasks = [task('d1', 'c2'), task('d2', 'c2'), task('t1', 'c1', ['d1', 'd2'])];

    render(ColumnArchiveTasksDialog, { column: DONE, open: true, onclose: () => {} });

    expect(screen.getByText(/1 card elsewhere on the board will lose a dependency/)).toBeVisible();
  });

  it('ignores a blocker edge between two cards inside the column', () => {
    board.tasks = [task('d1', 'c2'), task('d2', 'c2', ['d1'])];

    render(ColumnArchiveTasksDialog, { column: DONE, open: true, onclose: () => {} });

    expect(screen.queryByText(/lose a dependency/)).toBeNull();
  });

  it('archives the column and closes', async () => {
    board.tasks = [task('d1', 'c2')];
    const archiveTasks = vi.spyOn(board, 'archiveTasksInColumn').mockResolvedValue();
    const onclose = vi.fn();

    render(ColumnArchiveTasksDialog, { column: DONE, open: true, onclose });

    await fireEvent.click(screen.getByRole('button', { name: 'Archive cards' }));

    expect(archiveTasks).toHaveBeenCalledWith('c2');
    expect(onclose).toHaveBeenCalled();
  });

  it('counts every card in the column, not just the ones a filter shows', () => {
    board.tasks = [task('d1', 'c2'), task('d2', 'c2')];
    board.filterQuery = 'd1';

    render(ColumnArchiveTasksDialog, { column: DONE, open: true, onclose: () => {} });

    expect(screen.getByText(/Archive the 2 cards in/)).toBeInTheDocument();
  });
});
