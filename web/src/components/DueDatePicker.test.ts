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
  position: 1000,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  column_since: '2026-01-01T00:00:00Z',
  label_ids: [],
  assignee_ids: [],
  blocker_ids: [],
  image_count: 0,
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
  it('offers only the add affordance until it is used, with no field in the form', () => {
    render(DueDatePicker, { taskId: 't1' });

    expect(screen.getByRole('button', { name: '+ Add due date' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Due date')).not.toBeInTheDocument();
  });

  it('reveals the field on demand and patches the date it is given', async () => {
    render(DueDatePicker, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: '+ Add due date' }));
    const input = screen.getByLabelText('Due date');
    expect(input).toHaveValue('');

    await fireEvent.change(input, { target: { value: '2026-08-03' } });

    expect(await patchBody()).toEqual({ due_date: '2026-08-03' });
    await waitFor(() => {
      expect(board.tasks[0]!.due_date).toBe('2026-08-03');
    });
  });

  it('shows an existing date pre-filled, with no add affordance', () => {
    board.tasks = [{ ...task, due_date: '2026-08-03' }];
    render(DueDatePicker, { taskId: 't1' });

    expect(screen.getByLabelText('Due date')).toHaveValue('2026-08-03');
    expect(screen.queryByRole('button', { name: '+ Add due date' })).not.toBeInTheDocument();
  });

  it('clears the date, collapses back to the affordance and keeps focus', async () => {
    board.tasks = [{ ...task, due_date: '2026-08-03' }];
    render(DueDatePicker, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await patchBody()).toEqual({ due_date: null });
    const toggle = await screen.findByRole('button', { name: '+ Add due date' });
    expect(screen.queryByLabelText('Due date')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(toggle).toHaveFocus();
    });
  });

  it('leaves the date alone while the field is empty mid-edit', async () => {
    board.tasks = [{ ...task, due_date: '2026-08-03' }];
    render(DueDatePicker, { taskId: 't1' });

    await fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Due date')).toBeInTheDocument();
    expect(board.tasks[0]!.due_date).toBe('2026-08-03');
  });

  it('collapses the revealed field when the open task changes', async () => {
    board.tasks = [{ ...task }, { ...task, id: 't2' }];
    const { rerender } = render(DueDatePicker, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: '+ Add due date' }));
    expect(screen.getByLabelText('Due date')).toBeInTheDocument();

    await rerender({ taskId: 't2' });
    expect(screen.queryByLabelText('Due date')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add due date' })).toBeInTheDocument();
  });

  it('is read-only text on a public board, with nothing to press', () => {
    board.tasks = [{ ...task, due_date: '2026-08-03' }];
    render(DueDatePicker, { taskId: 't1', readonly: true });

    expect(screen.queryByLabelText('Due date')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });
});
