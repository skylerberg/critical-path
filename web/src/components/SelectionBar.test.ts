import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import SelectionBar from './SelectionBar.svelte';
import Project from '../routes/Project.svelte';
import { board } from '../lib/board.svelte';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';
import { shortcuts } from '../lib/shortcuts.svelte';
import { users } from '../lib/users.svelte';
import { testUuid } from '../lib/test-ids';
import { bulkTask, seedBulkBoard, ME } from './bulkTestSetup';

function bar(): HTMLElement | null {
  return screen.queryByRole('group', { name: 'Selection actions' });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, { users: [] }));
  users.reset();
  shortcuts.reset();
});

afterEach(() => {
  document.querySelectorAll('[data-task-id]').forEach((node) => node.remove());
  selection.clear();
  shortcuts.reset();
  board.reset();
  session.user = null;
  users.reset();
  vi.restoreAllMocks();
});

describe('SelectionBar', () => {
  it('stays out of the layout while nothing is selected', () => {
    seedBulkBoard([bulkTask('t1'), bulkTask('t2', 'c1', 2000)], []);

    render(SelectionBar);

    expect(bar()).toBeNull();
  });

  it('reports the count and offers every bulk action', () => {
    seedBulkBoard([bulkTask('t1'), bulkTask('t2', 'c1', 2000)], ['t1', 't2']);

    render(SelectionBar);

    expect(bar()).not.toBeNull();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    for (const name of ['Label', 'Assign', 'Move', 'Archive', 'Clear selection']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('appears for a single selected card, in the singular', () => {
    seedBulkBoard([bulkTask('t1'), bulkTask('t2', 'c1', 2000)], ['t1']);

    render(SelectionBar);

    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it.each([
    ['Label', 'labels'],
    ['Assign', 'assignees'],
    ['Move', 'move'],
    ['Archive', 'archive'],
  ] as const)('opens the %s bulk surface', async (name, kind) => {
    seedBulkBoard([bulkTask('t1'), bulkTask('t2', 'c1', 2000)], ['t1', 't2']);
    render(SelectionBar);

    await fireEvent.click(screen.getByRole('button', { name }));

    expect(shortcuts.bulkMenu).toBe(kind);
  });

  it('clears the selection and puts focus back on the cursor card', async () => {
    seedBulkBoard([bulkTask('t1'), bulkTask('t2', 'c1', 2000)], ['t1', 't2']);
    const card = document.createElement('div');
    card.dataset.taskId = 't2';
    card.tabIndex = 0;
    document.body.append(card);
    render(SelectionBar);

    await fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));

    expect(selection.selectedIds).toEqual([]);
    await waitFor(() => {
      expect(document.activeElement).toBe(card);
    });
    expect(bar()).toBeNull();
  });

  it('clears the selection on Escape and marks the key handled', async () => {
    seedBulkBoard([bulkTask('t1'), bulkTask('t2', 'c1', 2000)], ['t1', 't2']);
    render(SelectionBar);
    const button = screen.getByRole('button', { name: 'Label' });
    button.focus();

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    await tick();

    expect(selection.selectedIds).toEqual([]);
    // The shell's keymap skips a handled event, so the set is cleared once.
    expect(event.defaultPrevented).toBe(true);
    expect(bar()).toBeNull();
  });

  it('leaves other keys to the shell keymap', async () => {
    seedBulkBoard([bulkTask('t1'), bulkTask('t2', 'c1', 2000)], ['t1', 't2']);
    render(SelectionBar);
    const button = screen.getByRole('button', { name: 'Label' });

    const event = new KeyboardEvent('keydown', { key: 'l', bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    await tick();

    expect(event.defaultPrevented).toBe(false);
    expect(selection.count).toBe(2);
  });

  it('counts down as a teammate takes selected cards off the board', async () => {
    seedBulkBoard(
      [bulkTask('t1'), bulkTask('t2', 'c1', 2000), bulkTask('t3', 'c1', 3000)],
      ['t1', 't2', 't3']
    );
    render(SelectionBar);
    expect(screen.getByText('3 selected')).toBeInTheDocument();

    board.tasks = [bulkTask('t1')];
    await waitFor(() => {
      expect(screen.getByText('1 selected')).toBeInTheDocument();
    });

    board.tasks = [];
    await waitFor(() => {
      expect(bar()).toBeNull();
    });
  });

  it('goes away when the set outlives the edit rights that made it', async () => {
    seedBulkBoard([bulkTask('t1'), bulkTask('t2', 'c1', 2000)], ['t1', 't2']);
    render(SelectionBar);
    expect(bar()).not.toBeNull();

    board.project = {
      ...board.project!,
      created_by: 'u-someone-else',
      member_ids: [ME],
      members: [{ user_id: ME, role: 'viewer' }],
    };

    await waitFor(() => {
      expect(bar()).toBeNull();
    });
  });
});

const PROJECT_ID = testUuid('p-selection-bar');
const T1 = testUuid('t1-selection-bar');

function mockProject(): void {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL((input as Request).url);
    if (url.pathname === '/api/users') {
      return jsonResponse(200, { users: [] });
    }
    return jsonResponse(200, {
      users: [],
      project: {
        id: PROJECT_ID,
        name: 'Rulebook',
        description: '',
        archived_at: null,
        created_by: ME,
        member_ids: [],
        members: [],
        is_public: false,
        color: null,
        created_at: '2026-01-01T00:00:00Z',
      },
      columns: [
        { id: 'c1', name: 'To Do', position: 1000, sort_key: 'V0000010001', is_done: false },
      ],
      tasks: [{ ...bulkTask(T1), title: 'Boss fight' }],
      labels: [],
      changed_task_ids: [],
    });
  });
}

describe('SelectionBar in the project shell', () => {
  beforeEach(() => {
    session.user = {
      id: ME,
      name: 'Ada',
      email: 'ada@example.com',
      avatar_url: null,
      email_verified: false,
    };
    mockProject();
  });

  it('docks inside the height-bounded board column rather than over the viewport', async () => {
    render(Project, { props: { projectId: PROJECT_ID, view: 'board' } });
    await screen.findByText('Boss fight');

    selection.toggle(T1);
    await tick();

    const region = bar();
    expect(region).not.toBeNull();
    // The column ends where the mobile bottom nav begins, which is the whole
    // reason the bar can never cover it.
    expect(region!.parentElement?.className).toContain('h-[var(--cp-board-h)]');
  });

  it('does not draw on the graph view, which has no card set', async () => {
    render(Project, { props: { projectId: PROJECT_ID, view: 'graph' } });
    await screen.findByRole('heading', { name: 'Rulebook' });

    selection.toggle(T1);
    await tick();

    expect(bar()).toBeNull();
  });
});
