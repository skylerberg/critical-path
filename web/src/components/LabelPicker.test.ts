import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import LabelPicker from './LabelPicker.svelte';
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
  label_ids: ['l1'],
  assignee_ids: [],
  blocker_ids: [],
  image_count: 0,
};

beforeEach(() => {
  board.reset();
  board.labels = [
    { id: 'l1', name: 'art', color: '#ff0000' },
    { id: 'l2', name: 'rules', color: '#00ff00' },
  ];
  board.tasks = [task];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LabelPicker', () => {
  it('toggles a label on by calling setTaskLabels with the full set', async () => {
    const spy = vi.spyOn(board, 'setTaskLabels').mockResolvedValue(undefined);
    render(LabelPicker, { taskId: 't1' });

    expect(screen.getByRole('button', { name: 'art' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'rules' })).toHaveAttribute('aria-pressed', 'false');

    await fireEvent.click(screen.getByRole('button', { name: 'rules' }));
    expect(spy).toHaveBeenCalledWith('t1', ['l1', 'l2']);
  });

  it('toggles a label off by omitting it from the full set', async () => {
    const spy = vi.spyOn(board, 'setTaskLabels').mockResolvedValue(undefined);
    render(LabelPicker, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: 'art' }));
    expect(spy).toHaveBeenCalledWith('t1', []);
  });

  it('offers the shared Create affordance from the filter input', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, {}));
    board.currentProjectId = 'p1';
    render(LabelPicker, { taskId: 't1' });

    await fireEvent.input(screen.getByLabelText('Filter labels'), { target: { value: 'audio' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create "audio"' }));

    const created = board.labels.find((label) => label.name === 'audio');
    expect(created).toBeDefined();
    await waitFor(() => {
      expect(board.tasks.find((t) => t.id === 't1')?.label_ids).toContain(created!.id);
    });
  });
});
