import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import BulkLabelMenu from './BulkLabelMenu.svelte';
import { board } from '../lib/board.svelte';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';
import { bulkTask, seedBulkBoard } from './bulkTestSetup';

const ART = 'l-art';
const BUG = 'l-bug';

function seed(): void {
  seedBulkBoard(
    [
      bulkTask('t1', 'c1', 1000, { label_ids: [ART, BUG] }),
      bulkTask('t2', 'c1', 2000, { label_ids: [ART] }),
      bulkTask('t3', 'c1', 3000),
    ],
    ['t1', 't2']
  );
  board.labels = [
    { id: ART, name: 'art', color: '#ff0000' },
    { id: BUG, name: 'bug', color: '#00ff00' },
  ];
}

beforeEach(() => {
  seed();
});

afterEach(() => {
  selection.clear();
  session.user = null;
  vi.restoreAllMocks();
});

describe('BulkLabelMenu', () => {
  it('names the selection size and reports each label as all, some or none', () => {
    render(BulkLabelMenu, { onclose: () => {} });

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Labels on 2 cards');
    expect(screen.getByRole('button', { name: /art/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /bug/ })).toHaveAttribute('aria-pressed', 'mixed');
  });

  it('reports none when no selected card carries the label', () => {
    seedBulkBoard([bulkTask('t1'), bulkTask('t2', 'c1', 2000)], ['t1', 't2']);
    board.labels = [{ id: ART, name: 'art', color: '#ff0000' }];

    render(BulkLabelMenu, { onclose: () => {} });

    expect(screen.getByRole('button', { name: /art/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('turns a partly-applied label on for the whole set in one call', async () => {
    const bulkSetLabel = vi.spyOn(board, 'bulkSetLabel').mockResolvedValue();
    render(BulkLabelMenu, { onclose: () => {} });

    await fireEvent.click(screen.getByRole('button', { name: /bug/ }));

    expect(bulkSetLabel).toHaveBeenCalledTimes(1);
    expect(bulkSetLabel).toHaveBeenCalledWith(['t1', 't2'], BUG, true);
  });

  it('turns a fully-applied label off', async () => {
    const bulkSetLabel = vi.spyOn(board, 'bulkSetLabel').mockResolvedValue();
    render(BulkLabelMenu, { onclose: () => {} });

    await fireEvent.click(screen.getByRole('button', { name: /art/ }));

    expect(bulkSetLabel).toHaveBeenCalledWith(['t1', 't2'], ART, false);
  });

  it('filters the rows and offers no way to create a label', async () => {
    render(BulkLabelMenu, { onclose: () => {} });

    await fireEvent.input(screen.getByLabelText('Filter labels'), { target: { value: 'bu' } });

    expect(screen.queryByRole('button', { name: /art/ })).toBeNull();
    expect(screen.getByRole('button', { name: /bug/ })).toBeInTheDocument();
    expect(screen.queryByText(/Create/)).toBeNull();
  });

  // The rows read the live selection rather than a snapshot taken on open, so the
  // tri-state re-derives too: t1 alone carries "bug", so the row becomes all-on.
  it('drops a card a teammate deleted out of the target set without reopening', async () => {
    const bulkSetLabel = vi.spyOn(board, 'bulkSetLabel').mockResolvedValue();
    render(BulkLabelMenu, { onclose: () => {} });

    board.tasks = board.tasks.filter((task) => task.id !== 't2');
    await fireEvent.click(screen.getByRole('button', { name: /bug/ }));

    expect(bulkSetLabel).toHaveBeenCalledWith(['t1'], BUG, false);
  });
});
