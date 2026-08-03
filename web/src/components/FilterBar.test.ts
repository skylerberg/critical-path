import { fetchMock } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import FilterBar from './FilterBar.svelte';
import { board } from '../lib/board.svelte';
import { router } from '../lib/router.svelte';
import { projectHref } from '../lib/short-links';
import { shortcuts } from '../lib/shortcuts.svelte';
import { testUuid } from '../lib/test-ids';
import { users } from '../lib/users.svelte';
import type { BoardTask } from '../lib/board-types';

const PROJECT_ID = testUuid('p1');
const BOARD_PATH = projectHref(PROJECT_ID, 'Game');

function task(id: string, assigneeIds: string[]): BoardTask {
  return {
    id,
    column_id: 'c1',
    title: `Task ${id}`,
    description: null,
    position: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: assigneeIds,
    blocker_ids: [],
    image_count: 0,
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
  users.reset();
  shortcuts.reset();
  board.currentProjectId = PROJECT_ID;
  board.columns = [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }];
  users.users = [{ id: 'u1', name: 'Ada', avatar_url: null }];
});

afterEach(() => {
  router.navigate('/', { replace: true });
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

  it('focuses and selects the search input when the f shortcut requests it', async () => {
    board.tasks = [task('t1', [])];
    board.setFilterQuery('boss');

    render(FilterBar);
    const input = screen.getByLabelText<HTMLInputElement>('Filter tasks by title');
    shortcuts.filterFocusRequested = true;

    await waitFor(() => {
      expect(document.activeElement).toBe(input);
      expect(shortcuts.filterFocusRequested).toBe(false);
    });
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('boss'.length);
  });

  it('makes the narrowed board a shareable URL without growing the history', async () => {
    board.tasks = [task('t1', ['u1'])];
    router.navigate(BOARD_PATH, { replace: true });
    const historyBefore = window.history.length;

    render(FilterBar);
    await fireEvent.input(screen.getByLabelText('Filter tasks by title'), {
      target: { value: 'boss' },
    });

    await waitFor(() => {
      expect(router.path).toBe(`${BOARD_PATH}?q=boss`);
    });

    await fireEvent.click(screen.getByTitle('Filter by Ada'));
    expect(router.path).toBe(`${BOARD_PATH}?assignees=u1&q=boss`);

    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(router.path).toBe(BOARD_PATH);
    expect(window.history.length).toBe(historyBefore);
  });

  it('blurs the search input on Escape and keeps the filter applied', async () => {
    board.tasks = [task('t1', [])];
    board.setFilterQuery('boss');

    render(FilterBar);
    const input = screen.getByLabelText<HTMLInputElement>('Filter tasks by title');
    input.focus();
    await fireEvent.keyDown(input, { key: 'Escape' });

    expect(document.activeElement).not.toBe(input);
    expect(board.filterQuery).toBe('boss');
  });
});
