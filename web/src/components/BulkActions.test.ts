import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import BulkActions from './BulkActions.svelte';
import { board } from '../lib/board.svelte';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';
import { users } from '../lib/users.svelte';
import { ME, bulkTask, seedBulkBoard } from './bulkTestSetup';

beforeEach(() => {
  users.reset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, { users: [] }));
  seedBulkBoard([bulkTask('t1'), bulkTask('t2', 'c1', 2000)], ['t1', 't2']);
  board.labels = [{ id: 'l1', name: 'art', color: '#ff0000' }];
});

afterEach(() => {
  selection.clear();
  session.user = null;
  users.reset();
  vi.restoreAllMocks();
});

describe('BulkActions', () => {
  it.each([
    ['labels', 'Labels on 2 cards'],
    ['assignees', 'Assignees on 2 cards'],
    ['move', 'Move 2 cards to…'],
    ['archive', 'Archive cards'],
  ] as const)('mounts the %s surface', (kind, name) => {
    render(BulkActions, { kind, onclose: () => {} });

    expect(screen.getByRole('dialog')).toHaveAccessibleName(name);
  });

  it('closes itself once the last selected card leaves the board', async () => {
    const onclose = vi.fn();
    render(BulkActions, { kind: 'labels', onclose });
    expect(onclose).not.toHaveBeenCalled();

    board.tasks = [];

    await vi.waitFor(() => expect(onclose).toHaveBeenCalled());
  });

  // The SelectionBar that opened this is already gone by then, and every action
  // the menu offers would 403.
  it('closes itself when the set outlives the edit rights that made it', async () => {
    const onclose = vi.fn();
    render(BulkActions, { kind: 'move', onclose });
    expect(onclose).not.toHaveBeenCalled();

    board.project = {
      ...board.project!,
      created_by: 'u-someone-else',
      member_ids: [ME],
      members: [{ user_id: ME, role: 'viewer' }],
    };

    await vi.waitFor(() => expect(onclose).toHaveBeenCalled());
  });
});
