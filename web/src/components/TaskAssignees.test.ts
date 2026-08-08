import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import TaskAssignees from './TaskAssignees.svelte';
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
  assignee_ids: ['u-ada', 'u-alan'],
  blocker_ids: [],
  cover_image_url: null,
  due_date: null,
  comment_count: 0,
  checklist_item_count: 0,
  checklist_done_count: 0,
  attachment_count: 0,
  open_cross_project_blocker_count: 0,
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

describe('TaskAssignees', () => {
  it('names only the people actually assigned', () => {
    board.tasks = [{ ...task, assignee_ids: ['u-ada'] }];
    render(TaskAssignees, { taskId: 't1' });

    expect(screen.getByRole('button', { name: 'Unassign Ada Lovelace' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unassign Alan Turing' })).toBeNull();
  });

  it('unassigns the person it is asked to drop', async () => {
    const setTaskAssignees = vi.spyOn(board, 'setTaskAssignees').mockResolvedValue(undefined);
    render(TaskAssignees, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Unassign Ada Lovelace' }));
    expect(setTaskAssignees).toHaveBeenCalledWith('t1', ['u-alan']);
  });

  it('hands focus to a neighbor when one is unassigned', async () => {
    vi.spyOn(board, 'setTaskAssignees').mockResolvedValue(undefined);
    render(TaskAssignees, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Unassign Ada Lovelace' }));
    expect(screen.getByRole('button', { name: 'Unassign Alan Turing' })).toHaveFocus();
  });

  it('tells the caller when the last person goes', async () => {
    vi.spyOn(board, 'setTaskAssignees').mockResolvedValue(undefined);
    board.tasks = [{ ...task, assignee_ids: ['u-ada'] }];
    const onemptied = vi.fn();
    render(TaskAssignees, { taskId: 't1', onemptied });

    await fireEvent.click(screen.getByRole('button', { name: 'Unassign Ada Lovelace' }));
    expect(onemptied).toHaveBeenCalledOnce();
  });

  // The log outlives project membership, so it names people this client cannot
  // look up.
  it('names an assignee the users store cannot resolve', () => {
    board.tasks = [{ ...task, assignee_ids: ['departed'] }];
    render(TaskAssignees, { taskId: 't1' });

    expect(screen.getByRole('button', { name: 'Unassign Unknown user' })).toBeInTheDocument();
  });

  it('is plain text for a reader who cannot write', () => {
    render(TaskAssignees, { taskId: 't1', readonly: true });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });
});
