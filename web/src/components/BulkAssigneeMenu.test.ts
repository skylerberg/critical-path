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

  it('names the selection size and reports each user as all, some or none', () => {
    render(BulkAssigneeMenu, { onclose: () => {} });

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Assignees on 2 cards');
    expect(screen.getByRole('button', { name: /Ada/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Bob/ })).toHaveAttribute('aria-pressed', 'mixed');
  });

  it('assigns a partly-assigned user across the whole set in one call', async () => {
    const bulkSetAssignee = vi.spyOn(board, 'bulkSetAssignee').mockResolvedValue();
    render(BulkAssigneeMenu, { onclose: () => {} });

    await fireEvent.click(screen.getByRole('button', { name: /Bob/ }));

    expect(bulkSetAssignee).toHaveBeenCalledTimes(1);
    expect(bulkSetAssignee).toHaveBeenCalledWith(['t1', 't2'], BOB, true);
  });

  it('unassigns a user every selected card already has', async () => {
    const bulkSetAssignee = vi.spyOn(board, 'bulkSetAssignee').mockResolvedValue();
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
