import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import DependencyPicker from './DependencyPicker.svelte';
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
    task('t3', 'Print cards', ['t1']),
    task('t4', 'Sleeve cards'),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DependencyPicker', () => {
  describe('blocker direction', () => {
    it('excludes the task itself and its existing blockers', async () => {
      render(DependencyPicker, { taskId: 't1', direction: 'blocker' });

      const input = screen.getByLabelText('Search tasks to add as blockers');
      await fireEvent.input(input, { target: { value: 'cards' } });

      expect(screen.getByText('Print cards')).toBeInTheDocument();
      expect(screen.getByText('Sleeve cards')).toBeInTheDocument();
      expect(screen.queryByText('Design cards')).not.toBeInTheDocument();
      expect(screen.queryByText('Cut cards')).not.toBeInTheDocument();
    });

    it('adds the picked task as a blocker of this task and clears the query', async () => {
      const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      render(DependencyPicker, { taskId: 't1', direction: 'blocker' });

      const input = screen.getByLabelText<HTMLInputElement>('Search tasks to add as blockers');
      await fireEvent.input(input, { target: { value: 'sleeve' } });
      await fireEvent.click(screen.getByRole('button', { name: /Sleeve cards/ }));

      expect(spy).toHaveBeenCalledWith('t1', 't4');
      expect(input.value).toBe('');
    });
  });

  describe('blocked direction', () => {
    it('excludes the task itself and tasks it already blocks', async () => {
      render(DependencyPicker, { taskId: 't1', direction: 'blocked' });

      const input = screen.getByLabelText('Search tasks this one blocks');
      await fireEvent.input(input, { target: { value: 'cards' } });

      expect(screen.getByText('Cut cards')).toBeInTheDocument();
      expect(screen.getByText('Sleeve cards')).toBeInTheDocument();
      expect(screen.queryByText('Design cards')).not.toBeInTheDocument();
      expect(screen.queryByText('Print cards')).not.toBeInTheDocument();
    });

    it('adds this task as a blocker of the picked task and clears the query', async () => {
      const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      render(DependencyPicker, { taskId: 't1', direction: 'blocked' });

      const input = screen.getByLabelText<HTMLInputElement>('Search tasks this one blocks');
      await fireEvent.input(input, { target: { value: 'cut' } });
      await fireEvent.click(screen.getByRole('button', { name: /Cut cards/ }));

      expect(spy).toHaveBeenCalledWith('t2', 't1');
      expect(input.value).toBe('');
    });
  });

  describe('create option', () => {
    it('shows no Create row until the query matches no existing task', async () => {
      render(DependencyPicker, { taskId: 't1', direction: 'blocker' });

      const input = screen.getByLabelText('Search tasks to add as blockers');
      await fireEvent.input(input, { target: { value: 'Sleeve cards' } });

      expect(screen.queryByText('Create "Sleeve cards"')).not.toBeInTheDocument();

      await fireEvent.input(input, { target: { value: 'Playtest rules' } });

      expect(screen.getByText('Create "Playtest rules"')).toBeInTheDocument();
      expect(screen.queryByText('No matching tasks.')).not.toBeInTheDocument();
    });

    it('creates and links a new blocker in the blocker direction', async () => {
      const spy = vi.spyOn(board, 'createAndLinkTask').mockResolvedValue('new');
      render(DependencyPicker, { taskId: 't1', direction: 'blocker' });

      const input = screen.getByLabelText<HTMLInputElement>('Search tasks to add as blockers');
      await fireEvent.input(input, { target: { value: 'Playtest rules' } });
      await fireEvent.click(screen.getByRole('button', { name: /Create "Playtest rules"/ }));

      expect(spy).toHaveBeenCalledWith('Playtest rules', { blockerOf: 't1' });
      expect(input.value).toBe('');
    });

    it('creates and links a new blocked task in the blocked direction', async () => {
      const spy = vi.spyOn(board, 'createAndLinkTask').mockResolvedValue('new');
      render(DependencyPicker, { taskId: 't1', direction: 'blocked' });

      const input = screen.getByLabelText<HTMLInputElement>('Search tasks this one blocks');
      await fireEvent.input(input, { target: { value: 'Playtest rules' } });
      await fireEvent.click(screen.getByRole('button', { name: /Create "Playtest rules"/ }));

      expect(spy).toHaveBeenCalledWith('Playtest rules', { blockedBy: 't1' });
      expect(input.value).toBe('');
    });
  });
});
