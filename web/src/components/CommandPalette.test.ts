import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import CardMenu from './CardMenu.svelte';
import CommandPalette from './CommandPalette.svelte';
import { announcer } from '../lib/announcer.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';
import { cardMenu } from '../lib/card-menu.svelte';
import { projects } from '../lib/projects.svelte';
import { router } from '../lib/router.svelte';
import { SEARCH_MAX_QUERY_LENGTH, type SearchResult } from '../lib/search-query';
import { search } from '../lib/search.svelte';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';
import { projectHref, taskHref } from '../lib/short-links';
import { shortcuts } from '../lib/shortcuts.svelte';
import { taskRoute } from '../lib/task-route.svelte';
import { testUuid } from '../lib/test-ids';
import { toasts } from '../lib/toasts.svelte';

const DEBOUNCE_MS = 250;

const me = {
  id: 'u-me',
  name: 'Ada',
  email: 'ada@example.com',
  avatar_url: null,
  email_verified: false,
};
const PROJECT_ID = testUuid('p1');
const OTHER_PROJECT_ID = testUuid('p2');
const TASK_1 = testUuid('t1');
const TASK_2 = testUuid('t2');
const REMOTE_TASK = testUuid('t9');
const BOARD_PATH = projectHref(PROJECT_ID, 'Game');
const GRAPH_PATH = projectHref(PROJECT_ID, 'Game', 'graph');
const TASK_PATH = taskHref(TASK_1, 'Design cards');

function task(id: string, columnId: string, position: number, title: string): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    sort_key: `V0${String(Math.round(position)).padStart(8, '0')}1`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    attachment_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
  };
}

function project(id: string, name: string) {
  return {
    id,
    name,
    description: '',
    archived_at: null,
    created_by: me.id,
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00Z',
    open_task_count: 0,
    done_task_count: 0,
    sort_key: null,
    last_seen_at: null,
    has_unseen_changes: false,
  };
}

function result(taskKey: string, title: string, projectId = OTHER_PROJECT_ID): SearchResult {
  return {
    task_id: testUuid(taskKey),
    title,
    project_id: projectId,
    project_name: 'Atlas',
    column_name: 'In Progress',
  };
}

function respondWith(results: SearchResult[], truncated = false): void {
  fetchMock.mockImplementation(async () => jsonResponse(200, { results, truncated }));
}

let onclose: ReturnType<typeof vi.fn<() => void>>;

function open(): ReturnType<typeof render> {
  return render(CommandPalette, { ctx: board, onclose });
}

// Drains the microtasks an announcement and a deferred handoff wait on, without
// leaning on real timers.
async function settle(): Promise<void> {
  await tick();
  await tick();
}

function box(): HTMLInputElement {
  return screen.getByRole('combobox', { name: 'Command palette' });
}

function groupNames(): string[] {
  return screen.queryAllByRole('group').map((group) => group.getAttribute('aria-label') ?? '');
}

function actionsGroup(): HTMLElement | undefined {
  return screen
    .queryAllByRole('group')
    .find((group) => (group.getAttribute('aria-label') ?? '').startsWith('Actions'));
}

function optionLabels(groupLabel: string): string[] {
  const group = screen
    .queryAllByRole('group')
    .find((g) => (g.getAttribute('aria-label') ?? '').startsWith(groupLabel));
  return group === undefined
    ? []
    : within(group)
        .queryAllByRole('option')
        .map((option) => (option.querySelector('span')?.textContent ?? '').trim());
}

function activeOptionText(): string {
  const id = box().getAttribute('aria-activedescendant');
  const option = id === null ? null : document.getElementById(id);
  return (option?.querySelector('span')?.textContent ?? '').trim();
}

async function type(value: string): Promise<void> {
  await fireEvent.input(box(), { target: { value } });
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
  await tick();
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  respondWith([]);
  board.reset();
  projects.reset();
  search.reset();
  selection.clear();
  shortcuts.reset();
  cardMenu.reset();
  taskRoute.reset();
  announcer.clear();
  toasts.toasts = [];
  router.beforeNavigate = undefined;
  board.currentProjectId = PROJECT_ID;
  board.project = {
    id: PROJECT_ID,
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: me.id,
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00Z',
  };
  board.columns = [
    { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
    { id: 'done', name: 'Done', sort_key: 'V0000020001', is_done: true },
  ];
  board.labels = [
    { id: 'l1', name: 'art', color: '#ff0000' },
    { id: 'l2', name: 'rules', color: '#00ff00' },
  ];
  board.tasks = [task(TASK_1, 'c1', 1000, 'Design cards'), task(TASK_2, 'done', 1000, 'Ship it')];
  projects.projects = [project(PROJECT_ID, 'Game'), project(OTHER_PROJECT_ID, 'Atlas')];
  session.user = me;
  router.navigate(BOARD_PATH, { replace: true });
  selection.set(TASK_1);
  onclose = vi.fn<() => void>();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('rendering and grouping', () => {
  it('focuses the box and issues no request before anything is typed', () => {
    open();

    expect(box()).toHaveFocus();
    expect(box()).toHaveAttribute('maxlength', String(SEARCH_MAX_QUERY_LENGTH));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Type to search tasks in every project.');
  });

  it('leads with the actions for the selected card, in the right-click menu order', () => {
    open();

    expect(groupNames()[0]).toBe('Actions — Design cards');
    expect(optionLabels('Actions')).toEqual([
      'Labels…',
      'Assignees…',
      'Blocked by…',
      'Blocks…',
      'Move to…',
      'Mark done',
      'Duplicate',
      'Archive',
      'Copy link',
    ]);
  });

  it('prints each action key as a chip and mirrors it into aria-keyshortcuts', () => {
    open();

    const chips = within(actionsGroup()!)
      .queryAllByRole('option')
      .map((option) =>
        [...option.querySelectorAll('kbd')].map((kbd) => (kbd.textContent ?? '').trim())
      );

    expect(chips).toEqual([['l'], ['a'], ['b'], ['Shift+B'], ['m'], ['d'], ['Shift+D'], [], []]);
    expect(screen.getByRole('option', { name: /^Labels/ })).toHaveAttribute(
      'aria-keyshortcuts',
      'l'
    );
    expect(screen.getByRole('option', { name: /^Blocks/ })).toHaveAttribute(
      'aria-keyshortcuts',
      'Shift+B'
    );
    expect(screen.getByRole('option', { name: /^Archive/ })).not.toHaveAttribute(
      'aria-keyshortcuts'
    );
  });

  it('spells a chord out for assistive tech, which cannot read one as a list', () => {
    open();

    expect(screen.getByRole('option', { name: 'Board g then b' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Board g then b' })).not.toHaveAttribute(
      'aria-keyshortcuts'
    );
  });

  it('keeps every row out of the tab order, so the box holds focus', () => {
    open();

    for (const option of screen.queryAllByRole('option')) {
      expect(option).toHaveAttribute('tabindex', '-1');
    }
  });

  it('drops Mark done for a card that is already in a done column', () => {
    selection.set(TASK_2);

    open();

    expect(optionLabels('Actions')).toContain('Duplicate');
    expect(optionLabels('Actions')).not.toContain('Mark done');
  });

  it('drops Mark done on a board with no done column to move it to', () => {
    board.columns = [{ id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false }];

    open();

    expect(optionLabels('Actions')).toContain('Duplicate');
    expect(optionLabels('Actions')).not.toContain('Mark done');
  });

  it('offers no actions to a viewer, and no hint line either', () => {
    board.project = {
      ...board.project!,
      created_by: 'u-owner',
      member_ids: [me.id],
      members: [{ user_id: me.id, role: 'viewer' }],
    };

    open();

    expect(actionsGroup()).toBeUndefined();
    expect(screen.queryByText(/Select a card with/)).toBeNull();
    expect(optionLabels('Go to')).toContain('Board');
  });

  it('offers no actions off the project routes', () => {
    router.navigate('/my-tasks', { replace: true });

    open();

    expect(actionsGroup()).toBeUndefined();
    expect(optionLabels('Go to')).toEqual(['My tasks', 'All projects', 'Search all projects']);
  });

  it('offers no actions on the graph with nothing open, but still offers the board', () => {
    router.navigate(GRAPH_PATH, { replace: true });

    open();

    expect(actionsGroup()).toBeUndefined();
    expect(optionLabels('Go to')).toContain('Board');
  });

  it('points at the selection keys when a board has nothing selected', () => {
    selection.clear();

    open();

    expect(actionsGroup()).toBeUndefined();
    expect(screen.getByText(/Select a card with/)).toBeInTheDocument();
  });

  it('offers no actions for a target the loaded board does not hold', () => {
    board.tasks = [];

    open();

    expect(actionsGroup()).toBeUndefined();
    expect(screen.queryByText(/Select a card with/)).toBeNull();
  });

  it('lists the active projects and links each at its board', () => {
    open();

    expect(optionLabels('Projects')).toEqual(['Game', 'Atlas']);
  });

  it('matches the board columns and labels once something is typed', async () => {
    open();

    expect(optionLabels('Columns')).toEqual([]);
    expect(optionLabels('Labels')).toEqual([]);

    await type('do');
    expect(optionLabels('Columns')).toEqual(['Done', 'Todo']);

    await type('rul');
    expect(optionLabels('Labels')).toEqual(['rules']);
  });

  it('offers no column or label rows without an editable card to act on', async () => {
    selection.clear();
    open();

    await type('do');

    expect(optionLabels('Columns')).toEqual([]);
    expect(optionLabels('Labels')).toEqual([]);
  });

  it('offers no column or label rows to a viewer', async () => {
    board.project = {
      ...board.project!,
      created_by: 'u-owner',
      member_ids: [me.id],
      members: [{ user_id: me.id, role: 'viewer' }],
    };
    open();

    await type('do');

    expect(optionLabels('Columns')).toEqual([]);
    expect(optionLabels('Labels')).toEqual([]);
  });
});

describe('search', () => {
  it('debounces a run of keystrokes into one request', async () => {
    open();

    await fireEvent.input(box(), { target: { value: 'e' } });
    await fireEvent.input(box(), { target: { value: 'ex' } });
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(requestAt(0).url).searchParams.get('q')).toBe('ex');
  });

  it('leaves the search page untouched', async () => {
    respondWith([result('t-1', 'Ship the export API')]);
    open();

    await type('export');
    await waitFor(() => {
      expect(optionLabels('Tasks')).toEqual(['Ship the export API']);
    });

    expect(search.query).toBe('');
    expect(search.results).toEqual([]);
  });

  it('drops a stale response that lands after a newer one', async () => {
    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolve) => (releaseSlow = resolve));
    fetchMock.mockImplementationOnce(async () => {
      await slow;
      return jsonResponse(200, { results: [result('t-1', 'Stale hit')], truncated: false });
    });
    open();

    await fireEvent.input(box(), { target: { value: 'exp' } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    respondWith([result('t-2', 'Fresh hit')]);
    await type('export');
    await waitFor(() => {
      expect(optionLabels('Tasks')).toEqual(['Fresh hit']);
    });

    releaseSlow();
    await vi.advanceTimersByTimeAsync(0);
    await tick();

    expect(optionLabels('Tasks')).toEqual(['Fresh hit']);
  });

  it('writes nothing and throws nothing when a response lands after it closes', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    fetchMock.mockImplementation(async () => {
      await held;
      return jsonResponse(200, { results: [result('t-1', 'Late hit')], truncated: false });
    });
    const { unmount } = render(CommandPalette, { ctx: board, onclose });

    await fireEvent.input(box(), { target: { value: 'export' } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    unmount();

    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.queryByRole('option')).toBeNull();
  });

  it('cancels a pending request when it closes before the debounce elapses', async () => {
    const { unmount } = render(CommandPalette, { ctx: board, onclose });

    await fireEvent.input(box(), { target: { value: 'export' } });
    unmount();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for nothing when the box is emptied again', async () => {
    open();

    await type('export');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await type('');

    expect(screen.getByRole('status')).toHaveTextContent('Type to search tasks in every project.');
    expect(optionLabels('Tasks')).toEqual([]);
  });

  it('says it is searching from the keystroke, not from the request', async () => {
    open();

    await fireEvent.input(box(), { target: { value: 'zzzz' } });
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('No matches for “zzzz”.');
    });
  });

  it('counts the matches, and names a query that found none', async () => {
    respondWith([result('t-1', 'Ship the export API')]);
    open();

    await type('export');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 result');
    });

    respondWith([]);
    await type('zzzz');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('No matches for “zzzz”.');
    });
    expect(optionLabels('Go to')).toEqual(['Search all projects for “zzzz”']);
  });

  it('warns when the server capped the result set', async () => {
    respondWith([result('t-1', 'Ship the export API')], true);
    open();

    await type('export');

    await waitFor(() => {
      expect(screen.getByText(/Add another word to narrow it down/)).toBeInTheDocument();
    });
  });

  it('renders a failure, retries it, and keeps the local rows working meanwhile', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'Boom' }));
    open();

    await type('game');
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    });
    expect(optionLabels('Projects')).toEqual(['Game']);

    respondWith([result('t-1', 'Ship the export API')]);
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});

describe('keyboard', () => {
  it('moves the highlight across a group boundary and clamps at both ends', async () => {
    open();
    const rows = screen.queryAllByRole('option');
    const last = rows[rows.length - 1]!;

    expect(box()).toHaveAttribute('aria-activedescendant', rows[0]!.id);

    for (let i = 0; i < rows.length + 3; i++) {
      await fireEvent.keyDown(box(), { key: 'ArrowDown' });
    }
    expect(box()).toHaveAttribute('aria-activedescendant', last.id);
    expect(box()).toHaveFocus();

    for (let i = 0; i < rows.length + 3; i++) {
      await fireEvent.keyDown(box(), { key: 'ArrowUp' });
    }
    expect(box()).toHaveAttribute('aria-activedescendant', rows[0]!.id);
    expect(box()).toHaveFocus();
  });

  it('crosses from the last action into the first go-to row', async () => {
    open();
    for (let i = 0; i < 9; i++) {
      await fireEvent.keyDown(box(), { key: 'ArrowDown' });
    }

    expect(activeOptionText()).toBe('Board');
  });

  it('claims the arrow keys but leaves Home and End to the caret', async () => {
    open();

    const down = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      cancelable: true,
      bubbles: true,
    });
    box().dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);

    const home = new KeyboardEvent('keydown', { key: 'Home', cancelable: true, bubbles: true });
    box().dispatchEvent(home);
    expect(home.defaultPrevented).toBe(false);
  });

  it('closes on Escape without navigating, mutating or reaching the window', async () => {
    open();
    const onWindowKeydown = vi.fn();
    window.addEventListener('keydown', onWindowKeydown);

    try {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        cancelable: true,
        bubbles: true,
      });
      box().dispatchEvent(event);
      await tick();

      expect(onclose).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      expect(onWindowKeydown).not.toHaveBeenCalled();
      expect(router.path).toBe(BOARD_PATH);
      expect(shortcuts.labelMenu).toBeNull();
      expect(shortcuts.moveMenu).toBeNull();
    } finally {
      window.removeEventListener('keydown', onWindowKeydown);
    }
  });

  it('does nothing on a composing or repeated Enter', async () => {
    open();

    await fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
    await fireEvent.keyDown(box(), { key: 'Enter', repeat: true });

    expect(onclose).not.toHaveBeenCalled();
    expect(shortcuts.labelMenu).toBeNull();
  });

  it('holds the highlight on its row when rows shift underneath it', async () => {
    projects.projects = [
      { ...project(PROJECT_ID, 'Game'), sort_key: 'V0000010001' },
      { ...project(OTHER_PROJECT_ID, 'Atlas'), sort_key: 'V0000020001' },
    ];
    open();
    const rows = screen.queryAllByRole('option');
    for (let i = 0; i < rows.length - 1; i++) {
      await fireEvent.keyDown(box(), { key: 'ArrowDown' });
    }
    expect(activeOptionText()).toBe('Atlas');

    projects.projects = [
      ...projects.projects,
      { ...project(testUuid('p3'), 'Aardvark'), sort_key: 'V0000015001' },
    ];
    await tick();

    expect(optionLabels('Projects')).toEqual(['Game', 'Aardvark', 'Atlas']);
    expect(activeOptionText()).toBe('Atlas');
  });

  it('keeps the highlight where it is when a search payload lands under it', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    fetchMock.mockImplementation(async () => {
      await held;
      return jsonResponse(200, {
        results: [result('t-1', 'Ship the export API')],
        truncated: false,
      });
    });
    open();

    await fireEvent.input(box(), { target: { value: 'ga' } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await fireEvent.keyDown(box(), { key: 'ArrowDown' });
    const highlighted = activeOptionText();

    release();
    await vi.advanceTimersByTimeAsync(0);
    await tick();

    expect(optionLabels('Tasks')).toEqual(['Ship the export API']);
    expect(activeOptionText()).toBe(highlighted);
  });

  it('leaves Enter inert once the chosen row is gone', async () => {
    open();
    await fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(activeOptionText()).toBe('Assignees…');

    board.tasks = [];
    await tick();

    expect(box()).not.toHaveAttribute('aria-activedescendant');
    await fireEvent.keyDown(box(), { key: 'Enter' });

    expect(onclose).not.toHaveBeenCalled();
    expect(shortcuts.assigneeMenu).toBeNull();
  });

  it('fires nothing but the search jump when the query matches no command', async () => {
    respondWith([]);
    open();

    await type('zzzz');
    await fireEvent.keyDown(box(), { key: 'Enter' });

    expect(router.path).toBe('/search?q=zzzz');
    expect(shortcuts.labelMenu).toBeNull();
    expect(shortcuts.moveMenu).toBeNull();
    expect(shortcuts.anyMenuOpen).toBe(false);
  });
});

describe('activation', () => {
  it('navigates to a project board', async () => {
    open();

    await fireEvent.click(screen.getByRole('option', { name: /^Atlas/ }));

    expect(onclose).toHaveBeenCalled();
    expect(router.path).toBe(projectHref(OTHER_PROJECT_ID, 'Atlas'));
  });

  it('seeds the task-to-project map before jumping to a card', async () => {
    respondWith([result('t9', 'Remote card')]);
    open();
    await type('remote');
    await waitFor(() => {
      expect(optionLabels('Tasks')).toEqual(['Remote card']);
    });
    fetchMock.mockClear();

    await fireEvent.click(screen.getByRole('option', { name: /^Remote card/ }));

    expect(taskRoute.locate({ projectId: null, taskId: REMOTE_TASK })).toEqual({
      status: 'ready',
      projectId: OTHER_PROJECT_ID,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(router.path).toBe(taskHref(REMOTE_TASK, 'Remote card'));
  });

  it('closes before it hands a card off to a quick menu', async () => {
    open();

    box().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true })
    );

    expect(onclose).toHaveBeenCalledTimes(1);
    expect(shortcuts.labelMenu).toBeNull();

    await settle();
    expect(shortcuts.labelMenu).toBe(TASK_1);
  });

  it.each([
    ['Assignees…', () => expect(shortcuts.assigneeMenu).toBe(TASK_1)],
    [
      'Blocked by…',
      () => expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_1, direction: 'blocker' }),
    ],
    [
      'Blocks…',
      () => expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_1, direction: 'blocked' }),
    ],
    ['Move to…', () => expect(shortcuts.moveMenu).toBe(TASK_1)],
  ])('hands the card to the %s menu', async (label, assert) => {
    open();

    await fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${label}`) }));
    await tick();

    assert();
  });

  it('seeds the move menu from a column row instead of moving the card itself', async () => {
    const moveTask = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    open();
    await type('done');

    await fireEvent.click(screen.getByRole('option', { name: /^Done/ }));
    await settle();

    expect(shortcuts.moveMenu).toBe(TASK_1);
    expect(shortcuts.menuPrefill).toBe('Done');
    expect(moveTask).not.toHaveBeenCalled();
  });

  it('seeds the label menu from a label row instead of applying the label itself', async () => {
    const setTaskLabels = vi.spyOn(board, 'setTaskLabels').mockResolvedValue(undefined);
    open();
    await type('rules');

    await fireEvent.click(screen.getByRole('option', { name: /^rules/ }));
    await settle();

    expect(shortcuts.labelMenu).toBe(TASK_1);
    expect(shortcuts.menuPrefill).toBe('rules');
    expect(setTaskLabels).not.toHaveBeenCalled();
  });

  it('leaves no seed behind when a plain action row opens the same menu', async () => {
    shortcuts.menuPrefill = 'Done';
    open();

    await fireEvent.click(screen.getByRole('option', { name: /^Move to/ }));
    await settle();

    expect(shortcuts.moveMenu).toBe(TASK_1);
    expect(shortcuts.menuPrefill).toBe('');
  });

  it('copies the card link the right-click menu copies', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open();

    await fireEvent.click(screen.getByRole('option', { name: /^Copy link/ }));
    await settle();

    expect(writeText).toHaveBeenCalledWith(
      new URL(taskHref(TASK_1, 'Design cards'), window.location.origin).href
    );
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(toasts.toasts.map((toast) => toast.message)).toEqual(['Link copied']);
  });

  it('says so when the clipboard refuses the link', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    open();

    await fireEvent.click(screen.getByRole('option', { name: /^Copy link/ }));
    await settle();

    expect(toasts.toasts.map((toast) => toast.message)).toEqual(['Could not copy the link']);
  });

  it('duplicates once when the row is activated twice before the flush', async () => {
    const duplicateTask = vi.spyOn(board, 'duplicateTask').mockResolvedValue(TASK_2);
    open();
    const row = screen.getByRole('option', { name: /^Duplicate/ });

    row.click();
    row.click();

    expect(duplicateTask).toHaveBeenCalledTimes(1);
    expect(onclose).toHaveBeenCalledTimes(1);
    await settle();
    expect(announcer.message).toBe('Duplicated "Design cards"');
  });

  it('marks the card done and says so', async () => {
    const markTaskDone = vi.spyOn(board, 'markTaskDone').mockReturnValue(true);
    open();

    await fireEvent.click(screen.getByRole('option', { name: /^Mark done/ }));

    expect(markTaskDone).toHaveBeenCalledWith(TASK_1);
    await settle();
    expect(announcer.message).toBe('Marked "Design cards" done');
  });

  it('announces nothing when the board declines to mark it done', async () => {
    vi.spyOn(board, 'markTaskDone').mockReturnValue(false);
    open();

    await fireEvent.click(screen.getByRole('option', { name: /^Mark done/ }));
    await settle();

    expect(announcer.message).toBe('');
  });

  it('archives a merely-selected card without leaving the board', async () => {
    const archiveTask = vi.spyOn(board, 'archiveTask').mockResolvedValue(undefined);
    open();

    await fireEvent.click(screen.getByRole('option', { name: /^Archive/ }));
    await vi.advanceTimersByTimeAsync(0);

    expect(archiveTask).toHaveBeenCalledWith(TASK_1);
    expect(router.path).toBe(BOARD_PATH);
  });

  it('takes the overlay down with the card it archives, keeping the filters', async () => {
    const archiveTask = vi.spyOn(board, 'archiveTask').mockResolvedValue(undefined);
    board.setFilters({ labelIds: [], assigneeIds: [], query: 'boss' });
    router.navigate(TASK_PATH + '?q=boss', { replace: true });
    open();

    await fireEvent.click(screen.getByRole('option', { name: /^Archive/ }));
    await vi.advanceTimersByTimeAsync(0);

    expect(archiveTask).toHaveBeenCalledWith(TASK_1);
    expect(router.path).toBe(BOARD_PATH + '?q=boss');
  });

  it('returns to my tasks when that is where the overlay was opened from', async () => {
    vi.spyOn(board, 'archiveTask').mockResolvedValue(undefined);
    router.navigate(TASK_PATH + '?from=my-tasks', { replace: true });
    open();

    await fireEvent.click(screen.getByRole('option', { name: /^Archive/ }));
    await vi.advanceTimersByTimeAsync(0);

    expect(router.path).toBe('/my-tasks');
  });

  it('closes when the route moves out from under it', async () => {
    open();

    router.navigate('/my-tasks');
    await tick();

    expect(onclose).toHaveBeenCalled();
  });

  it('stays open when the board only rewrites its filters into the query string', async () => {
    open();

    board.setFilters({ labelIds: [], assigneeIds: [], query: 'boss' });
    await tick();

    expect(router.path).toBe(BOARD_PATH + '?q=boss');
    expect(onclose).not.toHaveBeenCalled();
  });
});

describe('pointer', () => {
  it('moves the highlight on pointermove without taking focus off the box', async () => {
    open();
    const row = screen.getByRole('option', { name: /^Move to/ });

    await fireEvent.pointerMove(row);

    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(box()).toHaveFocus();
  });

  it('keeps the box focused through a mousedown on a row', async () => {
    open();
    const row = screen.getByRole('option', { name: /^Move to/ });

    const event = new MouseEvent('mousedown', { cancelable: true, bubbles: true });
    row.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(box()).toHaveFocus();
  });
});

// A rename in the right-click menu that is not mirrored in the palette fails here.
describe('naming consistency with the right-click menu', () => {
  it('uses the menu labels, in the menu order', () => {
    open();
    const paletteLabels = optionLabels('Actions');

    cardMenu.open(TASK_1, 0, 0);
    render(CardMenu, { projectId: PROJECT_ID, canEdit: true });
    const menuLabels = screen
      .getAllByRole('menuitem')
      .map((item) => (item.querySelector('span')?.textContent ?? '').trim());

    expect(menuLabels).toEqual(expect.arrayContaining(paletteLabels));
    expect(menuLabels.filter((label) => paletteLabels.includes(label))).toEqual(paletteLabels);
  });
});
