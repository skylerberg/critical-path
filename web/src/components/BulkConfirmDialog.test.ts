import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import BulkConfirmDialog from './BulkConfirmDialog.svelte';
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
  vi.restoreAllMocks();
});

describe('BulkConfirmDialog', () => {
  it('counts the cards and promises the archive is reversible', () => {
    render(BulkConfirmDialog, { onclose: () => {} });

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Archive cards');
    expect(screen.getByText(/Archive the 2 selected cards/)).toBeInTheDocument();
    expect(screen.getByText(/can be restored/)).toBeInTheDocument();
  });

  it('offers no destructive alternative, since delete lives in the archive', () => {
    render(BulkConfirmDialog, { onclose: () => {} });

    expect(screen.queryByText(/cannot be undone/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });

  it('warns about the cards elsewhere that lose a dependency, counting each once', () => {
    seedBulkBoard(
      [
        bulkTask('t1'),
        bulkTask('t2', 'c1', 2000),
        bulkTask('t3', 'c2', 1000, { blocker_ids: ['t1', 't2'] }),
        bulkTask('t4', 'c2', 2000, { blocker_ids: ['t1'] }),
      ],
      ['t1', 't2']
    );

    render(BulkConfirmDialog, { onclose: () => {} });

    expect(screen.getByText(/2 cards elsewhere on the board will lose a dependency/)).toBeVisible();
  });

  it('says nothing about dependencies when the selection blocks nobody', () => {
    render(BulkConfirmDialog, { onclose: () => {} });

    expect(screen.queryByText(/lose a dependency/)).toBeNull();
  });

  it('archives the selection once on confirm and clears it', async () => {
    const bulkArchiveTasks = vi.spyOn(board, 'bulkArchiveTasks');
    const onclose = vi.fn();
    render(BulkConfirmDialog, { onclose });

    await fireEvent.click(screen.getByRole('button', { name: 'Archive cards' }));

    expect(bulkArchiveTasks).toHaveBeenCalledTimes(1);
    expect(bulkArchiveTasks).toHaveBeenCalledWith(['t1', 't2']);
    expect(selection.selectedIds).toEqual([]);
    expect(onclose).toHaveBeenCalled();
  });

  it('writes nothing and keeps the selection on cancel', async () => {
    const bulkArchiveTasks = vi.spyOn(board, 'bulkArchiveTasks');
    const onclose = vi.fn();
    render(BulkConfirmDialog, { onclose });

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(bulkArchiveTasks).not.toHaveBeenCalled();
    expect(selection.selectedIds).toEqual(['t1', 't2']);
    expect(onclose).toHaveBeenCalled();
  });
});
