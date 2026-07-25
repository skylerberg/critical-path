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

describe('LabelPicker', () => {
  it('shows only the applied labels as chips and keeps the picker collapsed', () => {
    render(LabelPicker, { taskId: 't1' });

    expect(screen.getByRole('button', { name: 'Remove label art' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove label rules' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Filter labels')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add label' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('removes only the clicked chip by calling setTaskLabels with the remaining set', async () => {
    board.tasks = [{ ...task, label_ids: ['l1', 'l2'] }];
    const spy = vi.spyOn(board, 'setTaskLabels').mockResolvedValue(undefined);
    render(LabelPicker, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove label art' }));
    expect(spy).toHaveBeenCalledWith('t1', ['l2']);
  });

  it('drops the last label when its chip is removed', async () => {
    const spy = vi.spyOn(board, 'setTaskLabels').mockResolvedValue(undefined);
    render(LabelPicker, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove label art' }));
    expect(spy).toHaveBeenCalledWith('t1', []);
  });

  it('reveals the autofocused picker behind the disclosure and collapses again', async () => {
    render(LabelPicker, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: '+ Add label' }));

    const input = screen.getByLabelText('Filter labels');
    expect(input).toBe(document.activeElement);
    const toggle = screen.getByRole('button', { name: 'Done' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(input);

    await fireEvent.click(toggle);
    expect(screen.queryByLabelText('Filter labels')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add label' })).toBeInTheDocument();
  });

  it('toggles a label on from the expanded picker', async () => {
    const spy = vi.spyOn(board, 'setTaskLabels').mockResolvedValue(undefined);
    render(LabelPicker, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: '+ Add label' }));
    expect(screen.getByRole('button', { name: 'art' })).toHaveAttribute('aria-pressed', 'true');

    await fireEvent.click(screen.getByRole('button', { name: 'rules' }));
    expect(spy).toHaveBeenCalledWith('t1', ['l1', 'l2']);
  });

  it('offers the shared Create affordance from the expanded picker', async () => {
    render(LabelPicker, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: '+ Add label' }));
    await fireEvent.input(screen.getByLabelText('Filter labels'), { target: { value: 'audio' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create "audio"' }));

    const created = board.labels.find((label) => label.name === 'audio');
    expect(created).toBeDefined();
    await waitFor(() => {
      expect(board.tasks.find((t) => t.id === 't1')?.label_ids).toContain(created!.id);
    });
    expect(await screen.findByRole('button', { name: 'Remove label audio' })).toBeInTheDocument();
  });

  it('collapses on Escape without letting the key reach the surrounding dialog', async () => {
    render(LabelPicker, { taskId: 't1' });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add label' }));

    const notPrevented = await fireEvent.keyDown(screen.getByLabelText('Filter labels'), {
      key: 'Escape',
    });

    expect(notPrevented).toBe(false);
    expect(screen.queryByLabelText('Filter labels')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: '+ Add label' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toBe(document.activeElement);
  });

  it('collapses the picker when the open task changes', async () => {
    board.tasks = [{ ...task }, { ...task, id: 't2', label_ids: [] }];
    const { rerender } = render(LabelPicker, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: '+ Add label' }));
    expect(screen.getByLabelText('Filter labels')).toBeInTheDocument();

    await rerender({ taskId: 't2' });
    expect(screen.queryByLabelText('Filter labels')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove label art' })).not.toBeInTheDocument();
  });
});

describe('LabelPicker focus handling', () => {
  it('moves focus to a neighbouring chip when one is removed', async () => {
    board.tasks = [{ ...task, label_ids: ['l1', 'l2'] }];
    render(LabelPicker, { taskId: 't1' });

    const first = screen.getByRole('button', { name: 'Remove label art' });
    first.focus();
    await fireEvent.click(first);

    expect(screen.getByRole('button', { name: 'Remove label rules' })).toHaveFocus();
  });

  it('falls back to the add toggle when the last chip is removed', async () => {
    board.tasks = [{ ...task, label_ids: ['l1'] }];
    render(LabelPicker, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove label art' }));

    expect(screen.getByRole('button', { name: '+ Add label' })).toHaveFocus();
  });
});
