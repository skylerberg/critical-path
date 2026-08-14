import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import TaskDependencies from './TaskDependencies.svelte';
import { board } from '../lib/board.svelte';
import { crossProjectDeps } from '../lib/crossProjectDeps.svelte';
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
  crossProjectDeps.reset();
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

  // `deps` stays null after a failure, so anything deriving "still loading" from
  // it alone waits for a response that is never coming.
  it('stops waiting on cross-project blockers that failed to load', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'boom' }));
    board.tasks = [
      task('t1', { blocker_ids: ['t2'], open_cross_project_blocker_count: 2 }),
      task('t2'),
    ];
    const { container } = render(TaskDependencies, { taskId: 't1' });
    crossProjectDeps.ensure('t1');

    await vi.waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeInTheDocument());
    expect(screen.getByRole('list', { name: 'Blocked by' })).toHaveAttribute('aria-busy', 'false');
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  // Dropping the skeletons takes the section's last row with it when every
  // blocker is a remote one, and the notice lives inside that section.
  it('still reports the failure on a card whose only blockers are the remote ones', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'boom' }));
    board.tasks = [task('t1', { open_cross_project_blocker_count: 2 })];
    const { container } = render(TaskDependencies, { taskId: 't1' });
    crossProjectDeps.ensure('t1');

    await vi.waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Blocked by' })).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
  });

  // The other side of that case: the panel refreshes on every card open, so a
  // failure that hides nothing must not hand a card its first dependency section.
  it('renders nothing when the read fails on a card with no dependencies', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'boom' }));
    board.tasks = [task('t1')];
    const { container } = render(TaskDependencies, { taskId: 't1' });
    crossProjectDeps.ensure('t1');

    await vi.waitFor(() => expect(crossProjectDeps.get('t1')?.error).toBe(true));
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
    expect(container.querySelector('ul')).toBeNull();
  });

  // The control for the case above: while the read is genuinely in flight the rows
  // the card knows are coming are reserved, and the list says it is busy.
  it('reserves a row per known cross-project blocker while the read is in flight', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    board.tasks = [
      task('t1', { blocker_ids: ['t2'], open_cross_project_blocker_count: 2 }),
      task('t2'),
    ];
    const { container } = render(TaskDependencies, { taskId: 't1' });
    crossProjectDeps.ensure('t1');

    await vi.waitFor(() =>
      expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
    );
    expect(screen.getByRole('list', { name: 'Blocked by' })).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('offers no remove control to a reader who cannot write', () => {
    board.tasks = [task('t1', { blocker_ids: ['t2'] }), task('t2')];
    render(TaskDependencies, { taskId: 't1', readonly: true });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Task t2')).toBeInTheDocument();
  });
});
