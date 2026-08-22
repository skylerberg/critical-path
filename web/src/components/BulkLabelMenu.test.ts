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
  it('opens with the caret in the filter field', () => {
    render(BulkLabelMenu, { onclose: () => {} });

    expect(screen.getByLabelText('Filter labels')).toHaveFocus();
  });

  describe('keyboard', () => {
    function filter() {
      return screen.getByLabelText('Filter labels');
    }

    it('acts on the first row when Enter comes with no arrow', async () => {
      const bulkSetLabel = vi.spyOn(board, 'bulkSetLabel');
      render(BulkLabelMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'Enter' });

      expect(bulkSetLabel).toHaveBeenCalledWith(['t1', 't2'], ART, false);
    });

    it('moves down to the second row', async () => {
      const bulkSetLabel = vi.spyOn(board, 'bulkSetLabel');
      render(BulkLabelMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'ArrowDown' });
      await fireEvent.keyDown(filter(), { key: 'Enter' });

      expect(bulkSetLabel).toHaveBeenCalledWith(['t1', 't2'], BUG, true);
    });

    it('clamps at the top', async () => {
      const bulkSetLabel = vi.spyOn(board, 'bulkSetLabel');
      render(BulkLabelMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'ArrowDown' });
      await fireEvent.keyDown(filter(), { key: 'ArrowUp' });
      await fireEvent.keyDown(filter(), { key: 'ArrowUp' });
      await fireEvent.keyDown(filter(), { key: 'Enter' });

      expect(bulkSetLabel).toHaveBeenCalledWith(['t1', 't2'], ART, false);
    });

    // The highlight is a label id, not a row number. Held as a number this toggles
    // "art" across the whole selection — the label that slid under the highlight,
    // not the one the user arrowed onto.
    it('stays on its label when a teammate inserts one above it', async () => {
      const bulkSetLabel = vi.spyOn(board, 'bulkSetLabel');
      render(BulkLabelMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'ArrowDown' });
      board.labels = [{ id: 'l-new', name: 'aardvark', color: '#0000ff' }, ...board.labels];
      await fireEvent.keyDown(filter(), { key: 'Enter' });

      expect(bulkSetLabel).toHaveBeenCalledWith(['t1', 't2'], BUG, true);
    });

    // Its row is gone; there is no "nearby" label that is a safe guess.
    it('leaves Enter inert when the highlighted label is deleted under it', async () => {
      const bulkSetLabel = vi.spyOn(board, 'bulkSetLabel');
      render(BulkLabelMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'ArrowDown' });
      board.labels = board.labels.filter((label) => label.id !== BUG);
      await fireEvent.keyDown(filter(), { key: 'Enter' });

      expect(bulkSetLabel).not.toHaveBeenCalled();
    });

    it('takes the arrow keys only while rows match the filter', async () => {
      render(BulkLabelMenu, { onclose: () => {} });

      expect(await fireEvent.keyDown(filter(), { key: 'ArrowDown' })).toBe(false);
      expect(await fireEvent.keyDown(filter(), { key: 'ArrowUp' })).toBe(false);

      await fireEvent.input(filter(), { target: { value: 'no label by that name' } });

      expect(await fireEvent.keyDown(filter(), { key: 'ArrowDown' })).toBe(true);
    });

    // This list scrolls at max-h-64 and had no reveal at all before, so arrowing
    // past the visible rows highlighted one nobody could see.
    it('scrolls the newly highlighted row into view', async () => {
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
      render(BulkLabelMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'ArrowDown' });

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('button', { name: /bug/ }));
    });

    it('sends the highlight back to the top when the query changes', async () => {
      const bulkSetLabel = vi.spyOn(board, 'bulkSetLabel');
      render(BulkLabelMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'ArrowDown' });
      await fireEvent.input(filter(), { target: { value: 'bu' } });
      await fireEvent.keyDown(filter(), { key: 'Enter' });

      expect(bulkSetLabel).toHaveBeenCalledWith(['t1', 't2'], BUG, true);
    });
  });

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
    const bulkSetLabel = vi.spyOn(board, 'bulkSetLabel');
    render(BulkLabelMenu, { onclose: () => {} });

    await fireEvent.click(screen.getByRole('button', { name: /bug/ }));

    expect(bulkSetLabel).toHaveBeenCalledTimes(1);
    expect(bulkSetLabel).toHaveBeenCalledWith(['t1', 't2'], BUG, true);
  });

  it('turns a fully-applied label off', async () => {
    const bulkSetLabel = vi.spyOn(board, 'bulkSetLabel');
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
    const bulkSetLabel = vi.spyOn(board, 'bulkSetLabel');
    render(BulkLabelMenu, { onclose: () => {} });

    board.tasks = board.tasks.filter((task) => task.id !== 't2');
    await fireEvent.click(screen.getByRole('button', { name: /bug/ }));

    expect(bulkSetLabel).toHaveBeenCalledWith(['t1'], BUG, false);
  });
});
