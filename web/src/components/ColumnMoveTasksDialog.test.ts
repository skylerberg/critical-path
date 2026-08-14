import { fetchMock } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ColumnMoveTasksDialog from './ColumnMoveTasksDialog.svelte';
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
const EMPTY: BoardColumn = {
  id: 'c3',
  name: 'Empty',
  sort_key: 'V0000030001',
  is_done: false,
};

function task(id: string, columnId: string, title = id): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
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

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  board.currentProjectId = 'p1';
  board.columns = [TODO, DONE, EMPTY];
  board.tasks = [task('t1', 'c1', 'alpha'), task('t2', 'c1', 'beta')];
  vi.restoreAllMocks();
});

describe('ColumnMoveTasksDialog', () => {
  it('offers every column but its own as a target', () => {
    render(ColumnMoveTasksDialog, { column: TODO, open: true, onclose: () => {} });

    const options = screen.getByLabelText('Move cards to').querySelectorAll('option');
    expect([...options].map((option) => option.textContent)).toEqual(['Done', 'Empty']);
  });

  it('moves the cards to the selected target and closes', async () => {
    const moveTasks = vi.spyOn(board, 'moveTasksToColumn');
    const onclose = vi.fn();

    render(ColumnMoveTasksDialog, { column: TODO, open: true, onclose });

    await fireEvent.change(screen.getByLabelText('Move cards to'), { target: { value: 'c3' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Move cards' }));

    expect(moveTasks).toHaveBeenCalledWith('c1', 'c3');
    expect(onclose).toHaveBeenCalled();
  });

  it('counts every card in the column, not just the ones a filter shows', () => {
    board.filterQuery = 'alpha';

    render(ColumnMoveTasksDialog, { column: TODO, open: true, onclose: () => {} });

    expect(screen.getByText(/Move the 2 cards in/)).toBeInTheDocument();
  });
});
