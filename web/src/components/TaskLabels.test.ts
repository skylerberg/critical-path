import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import TaskLabels from './TaskLabels.svelte';
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
  label_ids: ['l1', 'l2'],
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

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, {}));
  board.reset();
  board.currentProjectId = 'p1';
  board.labels = [
    { id: 'l1', name: 'art', color: '#ff0000' },
    { id: 'l2', name: 'rules', color: '#00ff00' },
  ];
  board.tasks = [{ ...task }];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskLabels', () => {
  it('renders a chip for every applied label', () => {
    render(TaskLabels, { taskId: 't1' });

    expect(screen.getByRole('button', { name: 'Remove label art' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove label rules' })).toBeInTheDocument();
  });

  it('drops the label it is asked to remove', async () => {
    const setTaskLabels = vi.spyOn(board, 'setTaskLabels').mockResolvedValue(undefined);
    render(TaskLabels, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove label art' }));
    expect(setTaskLabels).toHaveBeenCalledWith('t1', ['l2']);
  });

  // The clicked chip unmounts, so focus has to be handed somewhere before it goes
  // or it falls back to the dialog body.
  it('hands focus to a neighbouring chip when one is removed', async () => {
    vi.spyOn(board, 'setTaskLabels').mockResolvedValue(undefined);
    render(TaskLabels, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove label art' }));
    expect(screen.getByRole('button', { name: 'Remove label rules' })).toHaveFocus();
  });

  it('tells the caller when the last chip goes', async () => {
    vi.spyOn(board, 'setTaskLabels').mockResolvedValue(undefined);
    board.tasks = [{ ...task, label_ids: ['l1'] }];
    const onemptied = vi.fn();
    render(TaskLabels, { taskId: 't1', onemptied });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove label art' }));
    expect(onemptied).toHaveBeenCalledOnce();
  });

  it('is plain text for a reader who cannot write', () => {
    render(TaskLabels, { taskId: 't1', readonly: true });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('art')).toBeInTheDocument();
  });
});
