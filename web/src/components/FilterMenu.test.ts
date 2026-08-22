import { fetchMock } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import FilterMenu from './FilterMenu.svelte';
import { board } from '../lib/board.svelte';
import { testUuid } from '../lib/test-ids';
import { users } from '../lib/users.svelte';
import type { BoardTask } from '../lib/board-types';

const PROJECT_ID = testUuid('p1');

const ADA = { id: 'u1', name: 'Ada', avatar_url: null };
const ALAN = { id: 'u2', name: 'Alan', avatar_url: null };

function task(id: string, labelIds: string[], assigneeIds: string[]): BoardTask {
  return {
    id,
    column_id: 'c1',
    title: `Task ${id}`,
    description: null,
    sort_key: 'V0000010001',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: labelIds,
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

function renderMenu(): { onexit: ReturnType<typeof vi.fn> } {
  const onexit = vi.fn();
  render(FilterMenu, { props: { assignees: [ADA, ALAN], onexit } });
  return { onexit };
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-filter-option]')];
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  users.reset();
  board.currentProjectId = PROJECT_ID;
  board.columns = [{ id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false }];
  board.labels = [
    { id: 'l1', name: 'art', color: '#ff0000' },
    { id: 'l2', name: 'bug', color: '#00ff00' },
  ];
  board.tasks = [task('t1', ['l1'], ['u1']), task('t2', ['l1'], [])];
  users.users = [ADA, ALAN];
});

describe('FilterMenu', () => {
  it('lists every label and every given assignee with its task count', () => {
    renderMenu();

    expect(screen.getByRole('group', { name: 'Labels' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'art 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'bug 0' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Assignees' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ada 1/ })).toBeInTheDocument();
    // A member nobody has been assigned to is still filterable.
    expect(screen.getByRole('button', { name: /Alan 0/ })).toBeInTheDocument();
  });

  it('toggles the shared label and assignee filters', async () => {
    renderMenu();

    await fireEvent.click(screen.getByRole('button', { name: 'art 2' }));
    expect(board.filterLabelIds).toEqual(['l1']);
    expect(screen.getByRole('button', { name: 'art 2' })).toHaveAttribute('aria-pressed', 'true');

    await fireEvent.click(screen.getByRole('button', { name: /Ada 1/ }));
    expect(board.filterAssigneeIds).toEqual(['u1']);

    await fireEvent.click(screen.getByRole('button', { name: 'art 2' }));
    expect(board.filterLabelIds).toEqual([]);
  });

  // The panel stays open only while the search box keeps the caret, so a click
  // must not move focus onto the row it toggled.
  it('leaves focus alone when a row is clicked with the pointer', async () => {
    renderMenu();
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();

    const canceled = !(await fireEvent.mouseDown(screen.getByRole('button', { name: 'art 2' })));

    expect(canceled).toBe(true);
    expect(document.activeElement).toBe(outside);
  });

  it('roves focus down and up through both sections as one list', async () => {
    renderMenu();
    const [art, bug, ada] = rows();

    art!.focus();
    await fireEvent.keyDown(art!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(bug);

    await fireEvent.keyDown(bug!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(ada);

    await fireEvent.keyDown(ada!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(bug);
  });

  it('jumps to the ends with Home and End and stops at the last row', async () => {
    renderMenu();
    const items = rows();
    const first = items[0]!;
    const last = items[items.length - 1]!;

    first.focus();
    await fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement).toBe(last);

    await fireEvent.keyDown(last, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(last);

    await fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });

  it('hands focus back to the search box off the top of the list', async () => {
    const { onexit } = renderMenu();
    const first = rows()[0]!;
    first.focus();

    await fireEvent.keyDown(first, { key: 'ArrowUp' });

    expect(onexit).toHaveBeenCalled();
  });

  // Popover reads defaultPrevented to decide whether the body claimed Escape:
  // the first press steps back to the box, and the second — pressed there —
  // closes the panel.
  it('claims Escape to step back to the search box', async () => {
    const { onexit } = renderMenu();
    const first = rows()[0]!;
    first.focus();

    const canceled = !(await fireEvent.keyDown(first, { key: 'Escape' }));

    expect(onexit).toHaveBeenCalled();
    expect(canceled).toBe(true);
  });

  it('renders only the assignee section when the project has no labels', () => {
    board.labels = [];
    renderMenu();

    expect(screen.queryByRole('group', { name: 'Labels' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Assignees' })).toBeInTheDocument();
  });
});
