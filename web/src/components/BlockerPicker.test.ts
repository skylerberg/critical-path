import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import BlockerPicker from './BlockerPicker.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';

function task(id: string, title: string, blockerIds: string[] = []): BoardTask {
  return {
    id,
    column_id: 'c1',
    title,
    description: null,
    position: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: blockerIds,
    image_count: 0,
  };
}

beforeEach(() => {
  board.reset();
  board.tasks = [
    task('t1', 'Design cards', ['t2']),
    task('t2', 'Cut cards'),
    task('t3', 'Print cards'),
    task('t4', 'Sleeve cards'),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BlockerPicker', () => {
  it('excludes the task itself and existing blockers from search results', async () => {
    render(BlockerPicker, { taskId: 't1' });

    const input = screen.getByLabelText('Search tasks to add as blockers');
    await fireEvent.input(input, { target: { value: 'cards' } });

    expect(screen.getByText('Print cards')).toBeInTheDocument();
    expect(screen.getByText('Sleeve cards')).toBeInTheDocument();
    expect(screen.queryByText('Design cards')).not.toBeInTheDocument();
    expect(screen.queryByText('Cut cards')).not.toBeInTheDocument();
  });

  it('adds a blocker via the store and clears the query', async () => {
    const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(undefined);
    render(BlockerPicker, { taskId: 't1' });

    const input = screen.getByLabelText<HTMLInputElement>('Search tasks to add as blockers');
    await fireEvent.input(input, { target: { value: 'print' } });
    await fireEvent.click(screen.getByRole('button', { name: /Print cards/ }));

    expect(spy).toHaveBeenCalledWith('t1', 't3');
    expect(input.value).toBe('');
  });
});
