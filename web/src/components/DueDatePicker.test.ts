import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import DueDatePicker from './DueDatePicker.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';

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
  fetchMock.mockImplementation(async () => jsonResponse(200, { ...task, due_date: null }));
  board.reset();
  board.currentProjectId = 'p1';
  board.tasks = [{ ...task }];
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function patchBody(index = 0): Promise<unknown> {
  const request = requestAt(index);
  expect(request.method).toBe('PATCH');
  expect(new URL(request.url).pathname).toBe('/api/tasks/t1');
  return request.clone().json();
}

describe('DueDatePicker', () => {
  it('opens on the field, focused, ready to be typed into', () => {
    render(DueDatePicker, { taskId: 't1' });

    const input = screen.getByLabelText('Due date');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('patches the date it is given', async () => {
    render(DueDatePicker, { taskId: 't1' });

    await fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-08-03' } });

    expect(await patchBody()).toEqual({ due_date: '2026-08-03' });
    await waitFor(() => {
      expect(board.tasks[0]!.due_date).toBe('2026-08-03');
    });
  });

  it('shows an existing date pre-filled', () => {
    board.tasks = [{ ...task, due_date: '2026-08-03' }];
    render(DueDatePicker, { taskId: 't1' });

    expect(screen.getByLabelText('Due date')).toHaveValue('2026-08-03');
  });

  it('clears the date and tells the caller the section is empty', async () => {
    board.tasks = [{ ...task, due_date: '2026-08-03' }];
    const oncleared = vi.fn();
    render(DueDatePicker, { taskId: 't1', oncleared });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await patchBody()).toEqual({ due_date: null });
    expect(oncleared).toHaveBeenCalledOnce();
  });

  it('offers nothing to clear when there is no date yet', () => {
    render(DueDatePicker, { taskId: 't1' });

    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('leaves the date alone while the field is empty mid-edit', async () => {
    board.tasks = [{ ...task, due_date: '2026-08-03' }];
    render(DueDatePicker, { taskId: 't1' });

    await fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Due date')).toBeInTheDocument();
    expect(board.tasks[0]!.due_date).toBe('2026-08-03');
  });
});
