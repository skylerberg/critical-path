import { fetchMock } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ProjectHeader from './ProjectHeader.svelte';
import { board } from '../lib/board.svelte';
import { users } from '../lib/users.svelte';
import type { BoardTask } from '../lib/board-types';

function task(
  id: string,
  title: string,
  labelIds: string[] = [],
  assigneeIds: string[] = []
): BoardTask {
  return {
    id,
    column_id: 'c1',
    title,
    description: null,
    position: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    label_ids: labelIds,
    assignee_ids: assigneeIds,
    blocker_ids: [],
    image_count: 0,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  users.reset();
  board.currentProjectId = 'p1';
  board.project = {
    id: 'p1',
    name: 'Game',
    description: '',
    is_template: false,
    archived_at: null,
    created_by: null,
    workspace_id: null,
    created_at: '2026-01-01T00:00:00Z',
  };
  board.columns = [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }];
  board.labels = [{ id: 'l1', name: 'art', color: '#ff0000' }];
  board.tasks = [task('t1', 'Design cards', ['l1'], ['u1'])];
  users.users = [{ id: 'u1', email: 'ada@example.com', name: 'Ada' }];
});

describe('ProjectHeader', () => {
  it('renders label chips, assignee chips, and the title search inline on the board view', () => {
    render(ProjectHeader, { projectId: 'p1', view: 'board' });

    expect(screen.getByLabelText('Filter tasks by title')).toBeInTheDocument();
    expect(screen.getByText('art')).toBeInTheDocument();
    expect(screen.getByTitle('Filter by Ada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Board' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Graph' })).toBeInTheDocument();
  });

  it('hides the board filter cluster on the graph view', () => {
    render(ProjectHeader, { projectId: 'p1', view: 'graph' });

    expect(screen.queryByLabelText('Filter tasks by title')).not.toBeInTheDocument();
    expect(screen.queryByText('art')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Graph' })).toBeInTheDocument();
  });

  it('updates the shared filterQuery as the user types, which dims non-matching tasks', async () => {
    render(ProjectHeader, { projectId: 'p1', view: 'board' });

    const input = screen.getByLabelText<HTMLInputElement>('Filter tasks by title');
    await fireEvent.input(input, { target: { value: 'design' } });

    expect(board.filterQuery).toBe('design');
    expect(board.hasActiveFilters).toBe(true);
    expect(board.taskMatchesFilters(board.tasks[0]!)).toBe(true);
    expect(board.taskMatchesFilters({ ...board.tasks[0]!, id: 't2', title: 'Print cards' })).toBe(
      false
    );
  });
});
