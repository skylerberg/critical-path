import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import TaskDependencies from './TaskDependencies.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';

function task(id: string, overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id,
    column_id: 'c1',
    title: `Task ${id}`,
    description: null,
    sort_key: 'V0000010001',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
    open_cross_project_blocker_count: 0,
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, {}));
  board.reset();
  board.currentProjectId = 'p1';
  board.columns = [
    { id: 'c1', name: 'Doing', sort_key: 'V0000010001', is_done: false },
    { id: 'c2', name: 'Done', sort_key: 'V0000010002', is_done: true },
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskDependencies', () => {
  it('renders nothing when the task has no dependencies either way', () => {
    board.tasks = [task('t1')];
    const { container } = render(TaskDependencies, { taskId: 't1' });

    expect(screen.queryByRole('heading')).toBeNull();
    expect(container.querySelector('ul')).toBeNull();
  });

  it('lists what blocks this task and what it blocks', () => {
    board.tasks = [
      task('t1', { blocker_ids: ['t2'] }),
      task('t2'),
      task('t3', { blocker_ids: ['t1'] }),
    ];
    render(TaskDependencies, { taskId: 't1' });

    expect(screen.getByRole('heading', { name: 'Blocked by' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Blocks' })).toBeInTheDocument();
    expect(screen.getByText('Task t2')).toBeInTheDocument();
    expect(screen.getByText('Task t3')).toBeInTheDocument();
  });

  it('counts only the blockers that are not done yet', () => {
    board.tasks = [
      task('t1', { blocker_ids: ['t2', 't3'] }),
      task('t2'),
      task('t3', { column_id: 'c2' }),
    ];
    render(TaskDependencies, { taskId: 't1' });

    expect(screen.getByText('1 open task')).toBeInTheDocument();
    expect(screen.getByText('Task t3')).toHaveClass('line-through');
  });

  it('removes a blocker in the direction it was listed', async () => {
    const removeBlocker = vi.spyOn(board, 'removeBlocker');
    board.tasks = [task('t1', { blocker_ids: ['t2'] }), task('t2')];
    render(TaskDependencies, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove blocking task Task t2' }));
    expect(removeBlocker).toHaveBeenCalledWith('t1', 't2');
  });

  // The reverse relation is stored on the other task, so removing it has to name
  // the dependent as the one holding the blocker.
  it('removes a blocked task by unblocking it from this one', async () => {
    const removeBlocker = vi.spyOn(board, 'removeBlocker');
    board.tasks = [task('t1'), task('t3', { blocker_ids: ['t1'] })];
    render(TaskDependencies, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove blocked task Task t3' }));
    expect(removeBlocker).toHaveBeenCalledWith('t3', 't1');
  });

  it('offers no remove control to a reader who cannot write', () => {
    board.tasks = [task('t1', { blocker_ids: ['t2'] }), task('t2')];
    render(TaskDependencies, { taskId: 't1', readonly: true });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Task t2')).toBeInTheDocument();
  });
});
