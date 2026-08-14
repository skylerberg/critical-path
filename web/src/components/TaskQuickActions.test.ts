import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import TaskQuickActions from './TaskQuickActions.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';
import { testSortKey } from '../lib/test-ids';
import { users } from '../lib/users.svelte';

const FIRST_IN_DONE = testSortKey(0);
const LAST_IN_DONE = testSortKey(1);

const task: BoardTask = {
  id: 't1',
  column_id: 'c1',
  title: 'Design cards',
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
};

function renderBar(): {
  onreveal: ReturnType<typeof vi.fn>;
  onattach: ReturnType<typeof vi.fn>;
} {
  const onreveal = vi.fn();
  const onattach = vi.fn();
  render(TaskQuickActions, { taskId: 't1', onreveal, onattach });
  return { onreveal, onattach };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, {}));
  board.reset();
  users.reset();
  board.currentProjectId = 'p1';
  board.columns = [
    { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
    { id: 'c2', name: 'Done', sort_key: 'V0000010002', is_done: true },
  ];
  board.labels = [{ id: 'l1', name: 'art', color: '#ff0000' }];
  board.tasks = [{ ...task }];
  users.setForProject('p1', [{ id: 'u-ada', name: 'Ada Lovelace', avatar_url: null }]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskQuickActions', () => {
  it('offers every way into the card, with the column named on its own button', () => {
    renderBar();

    for (const name of ['Checklist', 'Dates', 'Assign', 'Labels', 'Attach', 'Dependencies']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // No Column section exists any more, so the button is the column display.
    expect(screen.getByRole('button', { name: 'Todo' })).toBeInTheDocument();
  });

  it('marks the open button as expanded and closes it on a second press', async () => {
    renderBar();

    const trigger = screen.getByRole('button', { name: 'Labels' });
    await fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Add labels' })).toBeInTheDocument();

    await fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Add labels' })).toBeNull();
  });

  it('opens at most one panel', async () => {
    renderBar();

    await fireEvent.click(screen.getByRole('button', { name: 'Dates' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Assign' }));

    expect(screen.queryByRole('group', { name: 'Dates' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Assign' })).toBeInTheDocument();
  });

  // The destination has to hold cards for the key to mean anything: against an
  // empty column append and prepend produce the same one.
  it('moves the card to the bottom of the column picked, and closes', async () => {
    const spy = vi.spyOn(board, 'moveTask');
    board.tasks = [
      { ...task },
      { ...task, id: 't2', column_id: 'c2', sort_key: FIRST_IN_DONE },
      { ...task, id: 't3', column_id: 'c2', sort_key: LAST_IN_DONE },
    ];
    renderBar();

    await fireEvent.click(screen.getByRole('button', { name: 'Todo' }));
    await fireEvent.click(
      within(screen.getByRole('group', { name: 'Move to column' })).getByRole('button', {
        name: 'Done',
      })
    );

    expect(spy).toHaveBeenCalledWith(
      't1',
      'c2',
      { sort_key: expect.any(String) },
      { kind: 'append' }
    );
    expect(spy.mock.calls[0]![2].sort_key > LAST_IN_DONE).toBe(true);
    expect(screen.queryByRole('group', { name: 'Move to column' })).toBeNull();
  });

  it('leaves the card alone when its current column is picked again', async () => {
    const spy = vi.spyOn(board, 'moveTask');
    renderBar();

    await fireEvent.click(screen.getByRole('button', { name: 'Todo' }));
    await fireEvent.click(
      within(screen.getByRole('group', { name: 'Move to column' })).getByRole('button', {
        name: /Todo/,
      })
    );

    expect(spy).not.toHaveBeenCalled();
  });

  it('asks the parent to reveal the checklist rather than opening a panel', async () => {
    const { onreveal } = renderBar();

    await fireEvent.click(screen.getByRole('button', { name: 'Checklist' }));

    expect(onreveal).toHaveBeenCalledWith('checklist');
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('hands the chosen way of attaching back to the parent, and closes', async () => {
    const { onattach } = renderBar();

    await fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    await fireEvent.click(
      within(screen.getByRole('group', { name: 'Attach' })).getByRole('button', {
        name: 'Attach file',
      })
    );

    expect(onattach).toHaveBeenCalledWith('file');
    expect(screen.queryByRole('group', { name: 'Attach' })).toBeNull();
  });

  it('holds both directions of dependency behind the one button', async () => {
    renderBar();

    await fireEvent.click(screen.getByRole('button', { name: 'Dependencies' }));
    const panel = screen.getByRole('group', { name: 'Dependencies' });

    expect(within(panel).getByLabelText('Search tasks that block this one')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Search tasks this one blocks')).toBeInTheDocument();
  });

  // The three exports are the card's only way to ask about the bar: TaskDetail
  // reads isOpen() to tell a backdrop click that dismisses a panel from one that
  // dismisses the card, and calls close() when it takes focus elsewhere.
  it('answers the card whether a panel is up, and closes the one that is', async () => {
    const { component } = render(TaskQuickActions, {
      taskId: 't1',
      onreveal: vi.fn(),
      onattach: vi.fn(),
    });
    expect(component.isOpen()).toBe(false);

    await fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
    expect(component.isOpen()).toBe(true);

    component.close({ restoreFocus: true });

    await waitFor(() => expect(screen.queryByRole('group', { name: 'Add labels' })).toBeNull());
    expect(component.isOpen()).toBe(false);
    expect(screen.getByRole('button', { name: 'Labels' })).toHaveFocus();
  });

  it('restores focus to the button that opened the panel on Escape', async () => {
    renderBar();

    const trigger = screen.getByRole('button', { name: 'Labels' });
    await fireEvent.click(trigger);
    await fireEvent.keyDown(screen.getByRole('group', { name: 'Add labels' }), { key: 'Escape' });

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  // A panel left open across a card switch would be editing the card just left.
  it('closes the open panel when the overlay switches card', async () => {
    board.tasks = [{ ...task }, { ...task, id: 't2' }];
    const { rerender } = render(TaskQuickActions, {
      taskId: 't1',
      onreveal: vi.fn(),
      onattach: vi.fn(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
    expect(screen.getByRole('group', { name: 'Add labels' })).toBeInTheDocument();

    await rerender({ taskId: 't2' });
    expect(screen.queryByRole('group', { name: 'Add labels' })).toBeNull();
  });
});
