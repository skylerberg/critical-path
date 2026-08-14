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
  // Held as a row number this moves the whole selection into "Todo" — the column
  // that slid under the highlight, not the one the user arrowed onto.
  it('stays on its column when a teammate inserts one above it', async () => {
    const bulkMoveTasks = vi.spyOn(board, 'bulkMoveTasks');
    render(BulkMoveMenu, { onclose: () => {} });

    const search = screen.getByLabelText('Search columns');
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    board.columns = [
      { id: 'c0', name: 'Backlog', sort_key: 'U0', is_done: false },
      ...board.columns,
    ];
    await fireEvent.keyDown(search, { key: 'Enter' });

    expect(bulkMoveTasks).toHaveBeenCalledWith(['t1', 't2'], 'c2');
  });

  it('scrolls the newly highlighted row into view', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(BulkMoveMenu, { onclose: () => {} });

    await fireEvent.keyDown(screen.getByLabelText('Search columns'), { key: 'ArrowDown' });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('button', { name: 'Done' }));
  });

  it('clamps at the top', async () => {
    const bulkMoveTasks = vi.spyOn(board, 'bulkMoveTasks');
    render(BulkMoveMenu, { onclose: () => {} });

    const search = screen.getByLabelText('Search columns');
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'ArrowUp' });
    await fireEvent.keyDown(search, { key: 'ArrowUp' });
    await fireEvent.keyDown(search, { key: 'Enter' });

    expect(bulkMoveTasks).toHaveBeenCalledWith(['t1', 't2'], 'c1');
  });

  // Nothing to move to, so the key belongs to the caret.
  it('leaves the arrow keys alone when nothing matches the filter', async () => {
    render(BulkMoveMenu, { onclose: () => {} });

    const search = screen.getByLabelText('Search columns');
    await fireEvent.input(search, { target: { value: 'nothing matches this' } });

    expect(await fireEvent.keyDown(search, { key: 'ArrowDown' })).toBe(true);
  });

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
    const bulkMoveTasks = vi.spyOn(board, 'bulkMoveTasks');
    const onclose = vi.fn();
    render(BulkMoveMenu, { onclose });

    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(bulkMoveTasks).toHaveBeenCalledTimes(1);
    expect(bulkMoveTasks).toHaveBeenCalledWith(['t1', 't2'], 'c2');
    expect(onclose).toHaveBeenCalled();
    await vi.waitFor(() => expect(announcer.message).toBe('Moved 2 cards to Done'));
  });

  it('refuses a second activation before the shell drops it', async () => {
    const bulkMoveTasks = vi.spyOn(board, 'bulkMoveTasks');
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
    const bulkMoveTasks = vi.spyOn(board, 'bulkMoveTasks');
    render(BulkMoveMenu, { onclose: () => {} });

    const search = screen.getByLabelText('Search columns');
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'Enter' });

    expect(bulkMoveTasks).toHaveBeenCalledWith(['t1', 't2'], 'c2');
  });
});
