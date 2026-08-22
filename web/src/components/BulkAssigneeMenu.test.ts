import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import BulkAssigneeMenu from './BulkAssigneeMenu.svelte';
import { board } from '../lib/board.svelte';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';
import { users } from '../lib/users.svelte';
import { ME, bulkTask, seedBulkBoard } from './bulkTestSetup';

const BOB = 'u-bob';

beforeEach(async () => {
  users.reset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    jsonResponse(200, {
      users: [
        { id: ME, name: 'Ada', avatar_url: null },
        { id: BOB, name: 'Bob', avatar_url: null },
      ],
    })
  );
  seedBulkBoard(
    [
      bulkTask('t1', 'c1', 1000, { assignee_ids: [ME, BOB] }),
      bulkTask('t2', 'c1', 2000, { assignee_ids: [ME] }),
    ],
    ['t1', 't2']
  );
  await users.loadForProject('p1');
});

afterEach(() => {
  selection.clear();
  session.user = null;
  users.reset();
  vi.restoreAllMocks();
});

describe('BulkAssigneeMenu', () => {
  it('opens with the caret in the filter field', () => {
    render(BulkAssigneeMenu, { onclose: () => {} });

    expect(screen.getByLabelText('Filter users')).toHaveFocus();
  });

  describe('keyboard', () => {
    function filter() {
      return screen.getByLabelText('Filter users');
    }

    it('acts on the first row when Enter comes with no arrow', async () => {
      const bulkSetAssignee = vi.spyOn(board, 'bulkSetAssignee');
      render(BulkAssigneeMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'Enter' });

      expect(bulkSetAssignee).toHaveBeenCalledWith(['t1', 't2'], ME, false);
    });

    it('moves down to the second row', async () => {
      const bulkSetAssignee = vi.spyOn(board, 'bulkSetAssignee');
      render(BulkAssigneeMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'ArrowDown' });
      await fireEvent.keyDown(filter(), { key: 'Enter' });

      expect(bulkSetAssignee).toHaveBeenCalledWith(['t1', 't2'], BOB, true);
    });

    it('clamps at the top', async () => {
      const bulkSetAssignee = vi.spyOn(board, 'bulkSetAssignee');
      render(BulkAssigneeMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'ArrowDown' });
      await fireEvent.keyDown(filter(), { key: 'ArrowUp' });
      await fireEvent.keyDown(filter(), { key: 'ArrowUp' });
      await fireEvent.keyDown(filter(), { key: 'Enter' });

      expect(bulkSetAssignee).toHaveBeenCalledWith(['t1', 't2'], ME, false);
    });

    // Held as a row number this assigns Ada across the whole selection — whoever
    // slid under the highlight, not the person the user arrowed onto.
    it('stays on its person when a search response inserts someone above', async () => {
      const bulkSetAssignee = vi.spyOn(board, 'bulkSetAssignee');
      render(BulkAssigneeMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'ArrowDown' });
      users.setForProject('p1', [
        { id: 'u-zoe', name: 'Aaron', avatar_url: null },
        ...users.forProject('p1'),
      ]);
      await fireEvent.keyDown(filter(), { key: 'Enter' });

      expect(bulkSetAssignee).toHaveBeenCalledWith(['t1', 't2'], BOB, true);
    });

    // Their row is gone, and the person who slid into it is not a safe guess
    // when Enter assigns across every selected card.
    it('leaves Enter inert when the highlighted person leaves the project', async () => {
      const bulkSetAssignee = vi.spyOn(board, 'bulkSetAssignee');
      render(BulkAssigneeMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'ArrowDown' });
      users.setForProject(
        'p1',
        users.forProject('p1').filter((user) => user.id !== BOB)
      );
      await fireEvent.keyDown(filter(), { key: 'Enter' });

      expect(bulkSetAssignee).not.toHaveBeenCalled();
    });

    it('takes the arrow keys only while rows match the filter', async () => {
      render(BulkAssigneeMenu, { onclose: () => {} });

      expect(await fireEvent.keyDown(filter(), { key: 'ArrowDown' })).toBe(false);
      expect(await fireEvent.keyDown(filter(), { key: 'ArrowUp' })).toBe(false);

      await fireEvent.input(filter(), { target: { value: 'nobody by that name' } });

      expect(await fireEvent.keyDown(filter(), { key: 'ArrowDown' })).toBe(true);
    });

    it('scrolls the newly highlighted row into view', async () => {
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
      render(BulkAssigneeMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'ArrowDown' });

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('button', { name: /Bob/ }));
    });

    it('sends the highlight back to the top when the query changes', async () => {
      const bulkSetAssignee = vi.spyOn(board, 'bulkSetAssignee');
      render(BulkAssigneeMenu, { onclose: () => {} });

      await fireEvent.keyDown(filter(), { key: 'ArrowDown' });
      await fireEvent.input(filter(), { target: { value: 'b' } });
      await fireEvent.keyDown(filter(), { key: 'Enter' });

      expect(bulkSetAssignee).toHaveBeenCalledWith(['t1', 't2'], BOB, true);
    });
  });

  it('names the selection size and reports each user as all, some or none', () => {
    render(BulkAssigneeMenu, { onclose: () => {} });

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Assignees on 2 cards');
    expect(screen.getByRole('button', { name: /Ada/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Bob/ })).toHaveAttribute('aria-pressed', 'mixed');
  });

  it('assigns a partly-assigned user across the whole set in one call', async () => {
    const bulkSetAssignee = vi.spyOn(board, 'bulkSetAssignee');
    render(BulkAssigneeMenu, { onclose: () => {} });

    await fireEvent.click(screen.getByRole('button', { name: /Bob/ }));

    expect(bulkSetAssignee).toHaveBeenCalledTimes(1);
    expect(bulkSetAssignee).toHaveBeenCalledWith(['t1', 't2'], BOB, true);
  });

  it('unassigns a user every selected card already has', async () => {
    const bulkSetAssignee = vi.spyOn(board, 'bulkSetAssignee');
    render(BulkAssigneeMenu, { onclose: () => {} });

    await fireEvent.click(screen.getByRole('button', { name: /Ada/ }));

    expect(bulkSetAssignee).toHaveBeenCalledWith(['t1', 't2'], ME, false);
  });

  it('filters the list', async () => {
    render(BulkAssigneeMenu, { onclose: () => {} });

    await fireEvent.input(screen.getByLabelText('Filter users'), { target: { value: 'bo' } });

    expect(screen.queryByRole('button', { name: /Ada/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Bob/ })).toBeInTheDocument();
  });
});
