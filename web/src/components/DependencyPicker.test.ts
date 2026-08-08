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
    sort_key: 'V0000010001',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: blockerIds,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
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

      const input = screen.getByLabelText('Search tasks that block this one');
      expect(input).toHaveAttribute('autocapitalize', 'sentences');
      await fireEvent.input(input, { target: { value: 'cards' } });

      expect(screen.getByText('Print cards')).toBeInTheDocument();
      expect(screen.getByText('Sleeve cards')).toBeInTheDocument();
      expect(screen.queryByText('Design cards')).not.toBeInTheDocument();
      expect(screen.queryByText('Cut cards')).not.toBeInTheDocument();
    });

    it('adds the picked task as a blocker of this task and clears the query', async () => {
      const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      render(DependencyPicker, { taskId: 't1', direction: 'blocker' });

      const input = screen.getByLabelText<HTMLInputElement>('Search tasks that block this one');
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

      const input = screen.getByLabelText('Search tasks that block this one');
      await fireEvent.input(input, { target: { value: 'Sleeve cards' } });

      expect(screen.queryByText('Create "Sleeve cards"')).not.toBeInTheDocument();

      await fireEvent.input(input, { target: { value: 'Playtest rules' } });

      expect(screen.getByText('Create "Playtest rules"')).toBeInTheDocument();
      expect(screen.queryByText('No matching tasks.')).not.toBeInTheDocument();
    });

    it('creates and links a new blocker in the blocker direction', async () => {
      const spy = vi.spyOn(board, 'createAndLinkTask').mockResolvedValue('new');
      render(DependencyPicker, { taskId: 't1', direction: 'blocker' });

      const input = screen.getByLabelText<HTMLInputElement>('Search tasks that block this one');
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

  describe('autofocus', () => {
    it('focuses the search field on mount when asked', () => {
      render(DependencyPicker, { taskId: 't1', direction: 'blocker', autofocus: true });

      expect(screen.getByLabelText('Search tasks that block this one')).toHaveFocus();
    });

    it('leaves focus alone by default', () => {
      render(DependencyPicker, { taskId: 't1', direction: 'blocker' });

      expect(screen.getByLabelText('Search tasks that block this one')).not.toHaveFocus();
      expect(document.activeElement).toBe(document.body);
    });
  });

  describe('keyboard navigation', () => {
    // Query 'cards' in the blocker picker on t1 yields the rows
    // [Print cards (t3), Sleeve cards (t4), Create "cards"].
    async function typeCards(): Promise<HTMLInputElement> {
      render(DependencyPicker, { taskId: 't1', direction: 'blocker' });
      const input = screen.getByLabelText<HTMLInputElement>('Search tasks that block this one');
      await fireEvent.input(input, { target: { value: 'cards' } });
      return input;
    }

    it('adds the first suggestion on Enter without any arrow press', async () => {
      const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      const input = await typeCards();

      await fireEvent.keyDown(input, { key: 'Enter' });

      expect(spy).toHaveBeenCalledWith('t1', 't3');
      expect(input.value).toBe('');
      expect(input).toHaveFocus();
    });

    it('moves the highlight down and adds the highlighted suggestion', async () => {
      const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      const input = await typeCards();

      await fireEvent.keyDown(input, { key: 'ArrowDown' });
      await fireEvent.keyDown(input, { key: 'Enter' });

      expect(spy).toHaveBeenCalledWith('t1', 't4');
    });

    it('keeps focus in the search field when arrowing from it', async () => {
      const input = await typeCards();
      input.focus();

      await fireEvent.keyDown(input, { key: 'ArrowDown' });

      expect(input).toHaveFocus();
    });

    it('puts the Create row in the same index space, clamped at the last row', async () => {
      const spy = vi.spyOn(board, 'createAndLinkTask').mockResolvedValue('new');
      const input = await typeCards();

      await fireEvent.keyDown(input, { key: 'ArrowDown' });
      await fireEvent.keyDown(input, { key: 'ArrowDown' });
      await fireEvent.keyDown(input, { key: 'ArrowDown' });
      await fireEvent.keyDown(input, { key: 'Enter' });

      expect(spy).toHaveBeenCalledWith('cards', { blockerOf: 't1' });
      expect(input.value).toBe('');
    });

    it('never slides the highlight onto Create when the list shrinks', async () => {
      const addSpy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      const createSpy = vi.spyOn(board, 'createAndLinkTask').mockResolvedValue('new');
      const input = await typeCards();

      // Highlight the second suggestion, then let a realtime delete remove it.
      await fireEvent.keyDown(input, { key: 'ArrowDown' });
      board.tasks = board.tasks.filter((t) => t.id !== 't4');
      await fireEvent.keyDown(input, { key: 'Enter' });

      expect(createSpy).not.toHaveBeenCalled();
      expect(addSpy).toHaveBeenCalledWith('t1', 't3');
    });

    it('ignores arrow keys while no rows are shown', async () => {
      const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      render(DependencyPicker, { taskId: 't1', direction: 'blocker' });
      const input = screen.getByLabelText<HTMLInputElement>('Search tasks that block this one');

      await fireEvent.keyDown(input, { key: 'ArrowDown' });
      await fireEvent.input(input, { target: { value: 'cards' } });
      await fireEvent.keyDown(input, { key: 'Enter' });

      expect(spy).toHaveBeenCalledWith('t1', 't3');
    });

    it('leaves Enter to the IME while a composition is active', async () => {
      const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      const input = await typeCards();

      await fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

      expect(spy).not.toHaveBeenCalled();
      expect(input.value).toBe('cards');
    });

    it('clamps the highlight at the first row on ArrowUp', async () => {
      const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      const input = await typeCards();

      await fireEvent.keyDown(input, { key: 'ArrowDown' });
      await fireEvent.keyDown(input, { key: 'ArrowUp' });
      await fireEvent.keyDown(input, { key: 'ArrowUp' });
      await fireEvent.keyDown(input, { key: 'Enter' });

      expect(spy).toHaveBeenCalledWith('t1', 't3');
    });

    it('resets the highlight to the top row when the query changes', async () => {
      const addSpy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      const createSpy = vi.spyOn(board, 'createAndLinkTask').mockResolvedValue('new');
      const input = await typeCards();

      await fireEvent.keyDown(input, { key: 'ArrowDown' });
      await fireEvent.input(input, { target: { value: 'print' } });
      await fireEvent.keyDown(input, { key: 'Enter' });

      expect(addSpy).toHaveBeenCalledWith('t1', 't3');
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('styles only the highlighted row and gives every row a focus ring', async () => {
      const input = await typeCards();
      const first = screen.getByRole('button', { name: /Print cards/ });
      const second = screen.getByRole('button', { name: /Sleeve cards/ });

      expect(first.classList).toContain('bg-accent-soft');
      expect(first.classList).toContain('border-accent');
      expect(second.classList).not.toContain('bg-accent-soft');
      expect(second.classList).toContain('border-transparent');

      await fireEvent.keyDown(input, { key: 'ArrowDown' });

      expect(second.classList).toContain('bg-accent-soft');
      expect(second.classList).toContain('border-accent');
      expect(first.classList).not.toContain('bg-accent-soft');

      for (const row of [first, second]) {
        expect(row.classList).toContain('focus-visible:outline-accent');
        expect(row.classList).toContain('focus-visible:-outline-offset-2');
      }
    });

    it('moves focus with the highlight when arrowing from a focused row', async () => {
      const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      await typeCards();
      const first = screen.getByRole('button', { name: /Print cards/ });
      first.focus();

      await fireEvent.keyDown(first, { key: 'ArrowDown' });

      const second = screen.getByRole('button', { name: /Sleeve cards/ });
      expect(second).toHaveFocus();
      expect(second.classList).toContain('border-accent');

      await fireEvent.keyDown(second, { key: 'Enter' });

      expect(spy).toHaveBeenCalledWith('t1', 't4');
    });

    it('activates the focused row on Enter even when the pointer highlights another', async () => {
      const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      await typeCards();
      const first = screen.getByRole('button', { name: /Print cards/ });
      first.focus();
      await fireEvent.pointerMove(screen.getByRole('button', { name: /Sleeve cards/ }));

      await fireEvent.keyDown(first, { key: 'Enter' });

      expect(spy).toHaveBeenCalledWith('t1', 't3');
    });

    it('scrolls the newly highlighted row into view on ArrowDown', async () => {
      const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
      const input = await typeCards();

      await fireEvent.keyDown(input, { key: 'ArrowDown' });

      expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scrollSpy.mock.contexts[0]).toBe(screen.getByRole('button', { name: /Sleeve cards/ }));
    });

    it('returns focus to the search field after clicking a suggestion', async () => {
      vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      const input = await typeCards();

      await fireEvent.click(screen.getByRole('button', { name: /Sleeve cards/ }));

      expect(input).toHaveFocus();
      expect(input.value).toBe('');
    });

    it('clears the query on Escape and cancels the dialog close request', async () => {
      const input = await typeCards();

      const notPrevented = await fireEvent.keyDown(input, { key: 'Escape' });

      expect(notPrevented).toBe(false);
      expect(input.value).toBe('');
      expect(screen.queryByRole('button', { name: /Sleeve cards/ })).not.toBeInTheDocument();
      expect(input).toHaveFocus();
    });

    it('leaves Escape alone with an empty query so the task dialog still closes', async () => {
      render(DependencyPicker, { taskId: 't1', direction: 'blocker' });
      const input = screen.getByLabelText('Search tasks that block this one');

      const notPrevented = await fireEvent.keyDown(input, { key: 'Escape' });

      expect(notPrevented).toBe(true);
    });

    it('makes Enter a no-op when there are no rows', async () => {
      const addSpy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      const createSpy = vi.spyOn(board, 'createAndLinkTask').mockResolvedValue('new');
      // jsdom swallows exceptions thrown inside listeners and reports them as a
      // window 'error' event, so the empty-row guard has to be asserted that way.
      const errors: unknown[] = [];
      const onError = (event: ErrorEvent): void => {
        errors.push(event.error);
      };
      window.addEventListener('error', onError);
      render(DependencyPicker, { taskId: 't1', direction: 'blocker' });
      const input = screen.getByLabelText<HTMLInputElement>('Search tasks that block this one');

      await fireEvent.keyDown(input, { key: 'Enter' });
      // An exact title that is excluded matches nothing and offers no Create row.
      await fireEvent.input(input, { target: { value: 'Design cards' } });
      await fireEvent.keyDown(input, { key: 'Enter' });
      window.removeEventListener('error', onError);

      expect(errors).toEqual([]);
      expect(addSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
      expect(screen.getByText('No matching tasks.')).toBeInTheDocument();
      expect(input.value).toBe('Design cards');
    });

    it('arrows and adds in the blocked direction', async () => {
      const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
      render(DependencyPicker, { taskId: 't1', direction: 'blocked' });
      const input = screen.getByLabelText<HTMLInputElement>('Search tasks this one blocks');
      await fireEvent.input(input, { target: { value: 'cards' } });

      await fireEvent.keyDown(input, { key: 'Enter' });
      expect(spy).toHaveBeenCalledWith('t2', 't1');

      await fireEvent.input(input, { target: { value: 'cards' } });
      await fireEvent.keyDown(input, { key: 'ArrowDown' });
      await fireEvent.keyDown(input, { key: 'Enter' });
      expect(spy).toHaveBeenCalledWith('t4', 't1');
    });
  });
});
