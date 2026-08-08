import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import AssigneeSearchMenu from './AssigneeSearchMenu.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';
import { users } from '../lib/users.svelte';

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
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, {}));
  board.reset();
  users.reset();
  board.currentProjectId = 'p1';
  board.tasks = [{ ...task }];
  users.setForProject('p1', [
    { id: 'u-ada', name: 'Ada Lovelace', avatar_url: null },
    { id: 'u-alan', name: 'Alan Turing', avatar_url: null },
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssigneeSearchMenu', () => {
  it('filters project members by the query', async () => {
    render(AssigneeSearchMenu, { taskId: 't1' });
    await fireEvent.input(screen.getByLabelText('Filter users'), { target: { value: 'ada' } });

    expect(screen.getByRole('button', { name: /Ada Lovelace/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Alan Turing/ })).not.toBeInTheDocument();
  });

  it('assigns and unassigns through the same row', async () => {
    const setTaskAssignees = vi.spyOn(board, 'setTaskAssignees').mockResolvedValue(undefined);
    render(AssigneeSearchMenu, { taskId: 't1' });

    const row = screen.getByRole('button', { name: /Ada Lovelace/ });
    expect(row).toHaveAttribute('aria-pressed', 'false');
    await fireEvent.click(row);
    expect(setTaskAssignees).toHaveBeenCalledWith('t1', ['u-ada']);

    board.tasks = [{ ...task, assignee_ids: ['u-ada'] }];
    await fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }));
    expect(setTaskAssignees).toHaveBeenLastCalledWith('t1', []);
  });

  it('marks the people already assigned', () => {
    board.tasks = [{ ...task, assignee_ids: ['u-alan'] }];
    render(AssigneeSearchMenu, { taskId: 't1' });

    expect(screen.getByRole('button', { name: /Alan Turing/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('assigns the highlighted person on Enter', async () => {
    const setTaskAssignees = vi.spyOn(board, 'setTaskAssignees').mockResolvedValue(undefined);
    render(AssigneeSearchMenu, { taskId: 't1' });

    const input = screen.getByLabelText('Filter users');
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(setTaskAssignees).toHaveBeenCalledWith('t1', ['u-alan']);
  });

  it('says so when nothing matches', async () => {
    render(AssigneeSearchMenu, { taskId: 't1' });
    await fireEvent.input(screen.getByLabelText('Filter users'), { target: { value: 'zzz' } });

    expect(screen.getByText('No matching users.')).toBeInTheDocument();
  });

  // The enclosing <dialog> would otherwise take the same Escape as a request to
  // close the whole card.
  it('closes on Escape without letting the key reach the surrounding dialog', async () => {
    const onclose = vi.fn();
    const outer = vi.fn();
    document.body.addEventListener('keydown', outer);
    render(AssigneeSearchMenu, { taskId: 't1', onclose });

    await fireEvent.keyDown(screen.getByLabelText('Filter users'), { key: 'Escape' });
    document.body.removeEventListener('keydown', outer);

    expect(onclose).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it('leaves Escape alone when no caller asked to be told', async () => {
    const outer = vi.fn();
    document.body.addEventListener('keydown', outer);
    render(AssigneeSearchMenu, { taskId: 't1' });

    await fireEvent.keyDown(screen.getByLabelText('Filter users'), { key: 'Escape' });
    document.body.removeEventListener('keydown', outer);

    expect(outer).toHaveBeenCalledOnce();
  });
});
