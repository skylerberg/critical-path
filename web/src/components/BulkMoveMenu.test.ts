import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import BulkMoveMenu from './BulkMoveMenu.svelte';
import { announcer } from '../lib/announcer.svelte';
import { board } from '../lib/board.svelte';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';
import { bulkTask, seedBulkBoard } from './bulkTestSetup';

beforeEach(() => {
  seedBulkBoard([bulkTask('t1'), bulkTask('t2', 'c1', 2000), bulkTask('t3', 'c2')], ['t1', 't2']);
});

afterEach(() => {
  selection.clear();
  session.user = null;
  announcer.clear();
  vi.restoreAllMocks();
});

describe('BulkMoveMenu', () => {
  it('names the selection size and lists every column, with no position step', () => {
    render(BulkMoveMenu, { onclose: () => {} });

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Move 2 cards to…');
    expect(screen.getAllByRole('button').map((b) => b.textContent?.trim())).toEqual([
      'Todo',
      'Done',
    ]);
  });

  it('opens with the caret in the search field', () => {
    render(BulkMoveMenu, { onclose: () => {} });

    expect(screen.getByLabelText('Search columns')).toHaveFocus();
  });

  it('moves the whole selection in one call, closes, then announces', async () => {
    const bulkMoveTasks = vi.spyOn(board, 'bulkMoveTasks').mockResolvedValue();
    const onclose = vi.fn();
    render(BulkMoveMenu, { onclose });

    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(bulkMoveTasks).toHaveBeenCalledTimes(1);
    expect(bulkMoveTasks).toHaveBeenCalledWith(['t1', 't2'], 'c2');
    expect(onclose).toHaveBeenCalled();
    await vi.waitFor(() => expect(announcer.message).toBe('Moved 2 cards to Done'));
  });

  it('refuses a second activation before the shell drops it', async () => {
    const bulkMoveTasks = vi.spyOn(board, 'bulkMoveTasks').mockResolvedValue();
    render(BulkMoveMenu, { onclose: () => {} });

    const row = screen.getByRole('button', { name: 'Done' });
    await fireEvent.click(row);
    await fireEvent.click(row);

    expect(bulkMoveTasks).toHaveBeenCalledTimes(1);
  });

  it('filters the columns', async () => {
    render(BulkMoveMenu, { onclose: () => {} });

    await fireEvent.input(screen.getByLabelText('Search columns'), { target: { value: 'don' } });

    expect(screen.getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Done']);
  });

  it('commits the highlighted column on Enter', async () => {
    const bulkMoveTasks = vi.spyOn(board, 'bulkMoveTasks').mockResolvedValue();
    render(BulkMoveMenu, { onclose: () => {} });

    const search = screen.getByLabelText('Search columns');
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'Enter' });

    expect(bulkMoveTasks).toHaveBeenCalledWith(['t1', 't2'], 'c2');
  });
});
