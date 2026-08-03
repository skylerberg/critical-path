import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import QuickMoveMenu from './QuickMoveMenu.svelte';
import { announcer } from '../lib/announcer.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';

function task(id: string, columnId: string, title: string, position: number): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    position,
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
}

let onclose: ReturnType<typeof vi.fn<() => void>>;
let moveTask: MockInstance<typeof board.moveTask>;

beforeEach(() => {
  board.reset();
  announcer.clear();
  board.currentProjectId = 'p1';
  board.columns = [
    { id: 'todo', name: 'Todo', position: 1000, is_done: false },
    { id: 'doing', name: 'Doing', position: 2000, is_done: false },
    { id: 'done', name: 'Done', position: 3000, is_done: true },
  ];
  board.tasks = [
    task('t1', 'todo', 'Design cards', 1000),
    task('t4', 'todo', 'Write blurb', 2000),
    task('t5', 'todo', 'Sleeve cards', 3000),
    task('t2', 'doing', 'Cut cards', 1000),
    task('t3', 'doing', 'Print rules', 2000),
  ];
  onclose = vi.fn<() => void>();
  moveTask = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function open(): ReturnType<typeof render> {
  return render(QuickMoveMenu, { taskId: 't1', onclose });
}

function rowLabels(name: string): string[] {
  return Array.from(screen.getByRole('list', { name }).querySelectorAll('button')).map((button) =>
    (button.textContent ?? '').trim()
  );
}

async function chooseColumn(name: string): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
}

describe('QuickMoveMenu', () => {
  it('lists every column, marks the current one, and focuses the filter', () => {
    open();

    expect(screen.getByRole('heading', { level: 2, name: 'Move — Design cards' })).toBeVisible();
    expect(rowLabels('Destination columns')).toEqual(['Todo current', 'Doing', 'Done']);
    expect(screen.getByLabelText('Search columns')).toHaveFocus();
  });

  it('narrows the column list as the filter is typed', async () => {
    open();

    await fireEvent.input(screen.getByLabelText('Search columns'), { target: { value: 'doi' } });

    expect(rowLabels('Destination columns')).toEqual(['Doing']);
  });

  it('opens narrowed to the column a caller named, without moving anything itself', () => {
    render(QuickMoveMenu, { taskId: 't1', prefill: 'Done', onclose });

    expect(screen.getByLabelText<HTMLInputElement>('Search columns').value).toBe('Done');
    expect(rowLabels('Destination columns')).toEqual(['Done']);
    expect(moveTask).not.toHaveBeenCalled();
  });

  it('offers top, bottom and a row per following card in the chosen column', async () => {
    open();

    await chooseColumn('Doing');

    expect(
      screen.getByRole('heading', { level: 2, name: 'Move to Doing — Design cards' })
    ).toBeVisible();
    expect(rowLabels('Positions')).toEqual([
      'Top (before "Cut cards")',
      'Before "Print rules"',
      'Bottom (after "Print rules")',
    ]);
    expect(screen.getByLabelText('Search positions')).toHaveFocus();
  });

  it('excludes the moving card from the anchors of its own column', async () => {
    open();

    await chooseColumn('Todo');

    // "Write blurb" is the leading card, so Top is already its slot.
    expect(rowLabels('Positions')).toEqual([
      'Top (before "Write blurb")',
      'Before "Sleeve cards"',
      'Bottom (after "Sleeve cards")',
    ]);
  });

  it("finds the leading card's slot by typing its title", async () => {
    open();
    await chooseColumn('Doing');

    await fireEvent.input(screen.getByLabelText('Search positions'), { target: { value: 'cut' } });

    expect(rowLabels('Positions')).toEqual(['Top (before "Cut cards")']);
  });

  it.each([
    ['Top (before "Cut cards")', 0],
    ['Before "Print rules"', 1500],
    ['Bottom (after "Print rules")', 3000],
  ])('places the card at %s', async (row, position) => {
    open();
    await chooseColumn('Doing');

    await fireEvent.click(screen.getByRole('button', { name: row }));

    expect(moveTask).toHaveBeenCalledWith('t1', 'doing', position);
  });

  it('skips the position step for a destination with no other cards', async () => {
    open();

    await chooseColumn('Done');

    expect(moveTask).toHaveBeenCalledWith('t1', 'done', 1000);
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Search positions')).toBeNull();
  });

  it('announces the resulting column and ordinal', async () => {
    open();

    await chooseColumn('Doing');
    await fireEvent.click(screen.getByRole('button', { name: 'Before "Print rules"' }));

    await waitFor(() => {
      expect(announcer.message).toBe('Moved "Design cards" to Doing, position 2 of 3');
    });
  });

  it('activates the highlighted row with the arrow keys and Enter', async () => {
    open();
    await chooseColumn('Doing');

    const input = screen.getByLabelText('Search positions');
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(moveTask).toHaveBeenCalledWith('t1', 'doing', 1500);
  });

  it('re-resolves the anchor at commit time, so a card inserted meanwhile does not shift the slot', async () => {
    open();
    await chooseColumn('Doing');

    const input = screen.getByLabelText('Search positions');
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(rowLabels('Positions')).toEqual([
      'Top (before "Cut cards")',
      'Before "Print rules"',
      'Bottom (after "Print rules")',
    ]);

    board.tasks = [...board.tasks, task('t6', 'doing', 'New card', 500)];
    await waitFor(() => {
      expect(rowLabels('Positions')).toEqual([
        'Top (before "New card")',
        'Before "Cut cards"',
        'Before "Print rules"',
        'Bottom (after "Print rules")',
      ]);
    });

    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(moveTask).toHaveBeenCalledWith('t1', 'doing', 1500);
    await waitFor(() => {
      expect(announcer.message).toBe('Moved "Design cards" to Doing, position 3 of 4');
    });
  });

  it('falls back to the bottom when the anchor is deleted between render and click', async () => {
    open();
    await chooseColumn('Doing');
    const anchorRow = screen.getByRole('button', { name: 'Before "Print rules"' });

    // Clicked before Svelte can flush the removal away, which is the only way the
    // row and the live column can disagree.
    board.tasks = board.tasks.filter((t) => t.id !== 't3');
    anchorRow.click();

    expect(moveTask).toHaveBeenCalledWith('t1', 'doing', 2000);
  });

  it('unwinds the query first and the step second on Escape', async () => {
    open();
    await chooseColumn('Doing');

    const input = screen.getByLabelText<HTMLInputElement>('Search positions');
    await fireEvent.input(input, { target: { value: 'print' } });
    expect(rowLabels('Positions')).toEqual([
      'Before "Print rules"',
      'Bottom (after "Print rules")',
    ]);

    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(screen.getByLabelText('Search positions')).toBeInTheDocument();

    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByLabelText('Search columns')).toBeInTheDocument();
    expect(onclose).not.toHaveBeenCalled();
  });

  it('returns to the column list from the back button', async () => {
    open();
    await chooseColumn('Doing');

    await fireEvent.click(screen.getByRole('button', { name: '← Columns' }));

    expect(screen.getByLabelText('Search columns')).toBeInTheDocument();
    expect(rowLabels('Destination columns')).toEqual(['Todo current', 'Doing', 'Done']);
  });

  it('unwinds one step on Escape from the back button instead of letting it escape', async () => {
    open();
    await chooseColumn('Doing');
    const onWindowKeydown = vi.fn();
    window.addEventListener('keydown', onWindowKeydown);

    try {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      screen.getByRole('button', { name: '← Columns' }).dispatchEvent(event);
      await tick();

      expect(screen.getByLabelText('Search columns')).toBeInTheDocument();
      expect(event.defaultPrevented).toBe(true);
      expect(onWindowKeydown).not.toHaveBeenCalled();
      expect(onclose).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKeydown);
    }
  });

  it('ignores an auto-repeated Enter, so holding it cannot skip the position step', async () => {
    open();
    await fireEvent.input(screen.getByLabelText('Search columns'), { target: { value: 'doing' } });

    await fireEvent.keyDown(screen.getByLabelText('Search columns'), { key: 'Enter' });
    const input = screen.getByLabelText('Search positions');
    await fireEvent.keyDown(input, { key: 'Enter', repeat: true });

    expect(moveTask).not.toHaveBeenCalled();
    expect(rowLabels('Positions')).toEqual([
      'Top (before "Cut cards")',
      'Before "Print rules"',
      'Bottom (after "Print rules")',
    ]);
  });

  it('moves once when a row is activated twice before the menu unmounts', async () => {
    open();
    await chooseColumn('Doing');

    const row = screen.getByRole('button', { name: 'Bottom (after "Print rules")' });
    row.click();
    row.click();

    expect(moveTask).toHaveBeenCalledTimes(1);
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('closes when the task is deleted under the open menu', async () => {
    open();

    board.tasks = board.tasks.filter((t) => t.id !== 't1');

    await waitFor(() => {
      expect(onclose).toHaveBeenCalled();
    });
  });

  it('returns to the column list when the chosen column is deleted', async () => {
    open();
    await chooseColumn('Doing');

    board.columns = board.columns.filter((c) => c.id !== 'doing');

    await waitFor(() => {
      expect(screen.getByLabelText('Search columns')).toBeInTheDocument();
    });
    expect(onclose).not.toHaveBeenCalled();
  });

  it('closes and announces without waiting for the move to settle', async () => {
    moveTask.mockReturnValue(new Promise<void>(() => undefined));
    open();

    await chooseColumn('Done');

    expect(onclose).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(announcer.message).toBe('Moved "Design cards" to Done, position 1 of 1');
    });
  });
});
