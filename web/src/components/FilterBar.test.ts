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

const ADA = { id: 'u1', name: 'Ada', avatar_url: null };

function task(id: string, assigneeIds: string[]): BoardTask {
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
    assignee_ids: assigneeIds,
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

function searchBox(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>('Filter tasks by title');
}

async function openPanel(): Promise<HTMLInputElement> {
  const input = searchBox();
  input.focus();
  await fireEvent.focus(input);
  await screen.findByRole('group', { name: 'Label and assignee filters' });
  return input;
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  users.reset();
  shortcuts.reset();
  board.currentProjectId = PROJECT_ID;
  board.columns = [{ id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false }];
  board.labels = [{ id: 'l1', name: 'art', color: '#ff0000' }];
  users.users = [ADA];
  users.setForProject(PROJECT_ID, [ADA]);
});

afterEach(() => {
  router.navigate('/', { replace: true });
});

describe('FilterBar', () => {
  it('drives the shared title filter from the search input', async () => {
    board.tasks = [task('t1', [])];

    render(FilterBar);
    await fireEvent.input(searchBox(), { target: { value: 'boss' } });

    expect(board.filterQuery).toBe('boss');
    expect(board.hasActiveFilters).toBe(true);
  });

  it('lets the search input and its wrapper shrink so the header cannot overflow narrow viewports', () => {
    board.tasks = [task('t1', [])];

    render(FilterBar);
    const input = searchBox();
    expect(input.className).toContain('min-w-0');
    const label = input.closest('label')!;
    expect(label.className).toContain('min-w-0');
    expect(label.className).not.toContain('shrink-0');
  });

  // The bar itself only carries the search box now, so the options have to be
  // out of the header until someone reaches for them.
  it('keeps the label and assignee options out of the bar until the box is focused', async () => {
    board.tasks = [task('t1', ['u1'])];

    render(FilterBar);
    expect(screen.queryByRole('button', { name: 'art 0' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ada/ })).not.toBeInTheDocument();

    await openPanel();

    expect(screen.getByRole('button', { name: 'art 0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ada 1/ })).toBeInTheDocument();
  });

  it('lists every project member, not only the ones holding a task', async () => {
    board.tasks = [task('t1', [])];
    users.setForProject(PROJECT_ID, [ADA, { id: 'u2', name: 'Alan', avatar_url: null }]);

    render(FilterBar);
    await openPanel();

    expect(screen.getByRole('button', { name: /Ada 0/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alan 0/ })).toBeInTheDocument();
  });

  it('keeps the panel open and the caret in the box while options are toggled', async () => {
    board.tasks = [task('t1', ['u1'])];

    render(FilterBar);
    const input = await openPanel();
    await fireEvent.click(screen.getByRole('button', { name: /Ada 1/ }));

    expect(board.filterAssigneeIds).toEqual(['u1']);
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('group', { name: 'Label and assignee filters' })).toBeInTheDocument();
  });

  it('counts the selected options on the collapsed box', async () => {
    board.tasks = [task('t1', ['u1'])];
    board.toggleAssigneeFilter('u1');
    board.toggleLabelFilter('l1');

    render(FilterBar);
    const input = searchBox();
    expect(input).toHaveAccessibleDescription(/^2 selected\./);

    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(input).not.toHaveAccessibleDescription(/selected/);
  });

  it('keeps a selected assignee listed and Clear filters shown when the user vanishes from all tasks', async () => {
    board.tasks = [task('t1', ['u1'])];
    board.toggleAssigneeFilter('u1');
    users.setForProject(PROJECT_ID, []);

    render(FilterBar);
    await openPanel();
    expect(screen.getByRole('button', { name: /Ada/ })).toHaveAttribute('aria-pressed', 'true');

    board.tasks = [task('t1', [])];

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Ada/ })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(board.hasActiveFilters).toBe(false);
    expect(screen.queryByRole('button', { name: /Ada/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('opens nothing on a project with no labels and no members', async () => {
    board.tasks = [task('t1', [])];
    board.labels = [];
    users.setForProject(PROJECT_ID, []);

    render(FilterBar);
    const input = searchBox();
    input.focus();
    await fireEvent.focus(input);

    expect(
      screen.queryByRole('group', { name: 'Label and assignee filters' })
    ).not.toBeInTheDocument();
  });

  it('closes the panel on a pointerdown outside it', async () => {
    board.tasks = [task('t1', ['u1'])];

    render(FilterBar);
    await openPanel();
    await fireEvent.pointerDown(document.body);

    expect(
      screen.queryByRole('group', { name: 'Label and assignee filters' })
    ).not.toBeInTheDocument();
  });

  it('steps into the option list with ArrowDown and back out with Escape', async () => {
    board.tasks = [task('t1', ['u1'])];

    render(FilterBar);
    const input = await openPanel();
    await fireEvent.keyDown(input, { key: 'ArrowDown' });

    const firstOption = screen.getByRole('button', { name: 'art 0' });
    await waitFor(() => {
      expect(document.activeElement).toBe(firstOption);
    });

    await fireEvent.keyDown(firstOption, { key: 'Escape' });

    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('group', { name: 'Label and assignee filters' })).toBeInTheDocument();
  });

  it('focuses and selects the search input when the f shortcut requests it', async () => {
    board.tasks = [task('t1', [])];
    board.setFilterQuery('boss');

    render(FilterBar);
    const input = searchBox();
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
    await fireEvent.input(searchBox(), { target: { value: 'boss' } });

    await waitFor(() => {
      expect(router.path).toBe(`${BOARD_PATH}?q=boss`);
    });

    await openPanel();
    await fireEvent.click(screen.getByRole('button', { name: /Ada 1/ }));
    expect(router.path).toBe(`${BOARD_PATH}?assignees=u1&q=boss`);

    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(router.path).toBe(BOARD_PATH);
    expect(window.history.length).toBe(historyBefore);
  });

  it('closes the panel and blurs the search input on Escape, keeping the filter applied', async () => {
    board.tasks = [task('t1', ['u1'])];
    board.setFilterQuery('boss');

    render(FilterBar);
    const input = await openPanel();
    await fireEvent.keyDown(input, { key: 'Escape' });

    expect(document.activeElement).not.toBe(input);
    expect(
      screen.queryByRole('group', { name: 'Label and assignee filters' })
    ).not.toBeInTheDocument();
    expect(board.filterQuery).toBe('boss');
  });
});
