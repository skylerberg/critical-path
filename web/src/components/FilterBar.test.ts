import { fetchMock } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import FilterBar from './FilterBar.svelte';
import { board } from '../lib/board.svelte';
import { users } from '../lib/users.svelte';
import type { BoardTask } from '../lib/board-types';

function task(id: string, assigneeIds: string[]): BoardTask {
  return {
    id,
    column_id: 'c1',
    title: `Task ${id}`,
    description: null,
    position: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    label_ids: [],
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
  board.columns = [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }];
  users.users = [{ id: 'u1', email: 'ada@example.com', name: 'Ada' }];
});

describe('FilterBar', () => {
  it('drives the shared title filter from the search input', async () => {
    board.tasks = [task('t1', [])];

    render(FilterBar);
    const input = screen.getByLabelText<HTMLInputElement>('Filter tasks by title');
    await fireEvent.input(input, { target: { value: 'boss' } });

    expect(board.filterQuery).toBe('boss');
    expect(board.hasActiveFilters).toBe(true);
  });

  it('lets the search input and its wrapper shrink so the header cannot overflow narrow viewports', () => {
    board.tasks = [task('t1', [])];

    render(FilterBar);
    const input = screen.getByLabelText<HTMLInputElement>('Filter tasks by title');
    expect(input.className).toContain('min-w-0');
    const label = input.closest('label')!;
    expect(label.className).toContain('min-w-0');
    expect(label.className).not.toContain('shrink-0');
  });

  it('keeps a selected assignee chip and Clear filters when the user vanishes from all tasks', async () => {
    board.tasks = [task('t1', ['u1'])];
    board.toggleAssigneeFilter('u1');

    render(FilterBar);
    expect(screen.getByTitle('Filter by Ada')).toHaveAttribute('aria-pressed', 'true');

    board.tasks = [task('t1', [])];

    await waitFor(() => {
      expect(screen.getByTitle('Filter by Ada')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(board.hasActiveFilters).toBe(false);
    expect(screen.queryByTitle('Filter by Ada')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });
});
