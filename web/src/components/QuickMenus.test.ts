import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import QuickMenus from './QuickMenus.svelte';
import { announcer } from '../lib/announcer.svelte';
import { awayBoard, board } from '../lib/board.svelte';
import type { BoardPayload, BoardTask } from '../lib/board-types';
import { cardContext } from '../lib/card-context.svelte';
import { cardCursor } from '../lib/card-cursor.svelte';
import { myTasks, type MyTask } from '../lib/myTasks.svelte';
import { projects } from '../lib/projects.svelte';
import { router } from '../lib/router.svelte';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';
import { shortcuts } from '../lib/shortcuts.svelte';
import { projectHref } from '../lib/short-links';
import { taskRoute } from '../lib/task-route.svelte';
import { testUuid } from '../lib/test-ids';
import { users } from '../lib/users.svelte';

const me = {
  id: 'u-me',
  name: 'Ada',
  email: 'ada@example.com',
  avatar_url: null,
  email_verified: false,
};
const teammate = { id: 'u-bo', name: 'Bo', avatar_url: null };

const OPEN_PROJECT = testUuid('p-open');
const AWAY_PROJECT = testUuid('p-away');
const T1 = testUuid('t1');
const T2 = testUuid('t2');
const AWAY_TASK = testUuid('t-away');

function task(id: string, columnId: string, title: string, position = 1000): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    sort_key: `V0${String(Math.round(position)).padStart(8, '0')}1`,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    column_since: '2026-07-15T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  };
}

function payload(projectId: string, name: string, tasks: BoardTask[]): BoardPayload {
  return {
    project: {
      id: projectId,
      name,
      description: '',
      archived_at: null,
      created_by: me.id,
      member_ids: [],
      members: [],
      is_public: false,
      color: null,
      created_at: '2026-07-15T00:00:00Z',
    },
    columns: [
      { id: `${projectId}-todo`, name: 'To Do', sort_key: 'V0', is_done: false },
      { id: `${projectId}-done`, name: 'Done', sort_key: 'V1', is_done: true },
    ],
    tasks,
    labels: [{ id: `${projectId}-lab`, name: 'Urgent', color: '#ef4444' }],
    changed_task_ids: [],
  };
}

function projectRow(id: string, name: string) {
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
    created_at: '2026-07-15T00:00:00Z',
    open_task_count: 0,
    done_task_count: 0,
    sort_key: null,
    last_seen_at: null,
    has_unseen_changes: false,
  };
}

function myTask(id: string, projectId: string, title: string): MyTask {
  return {
    id,
    project_id: projectId,
    project_name: 'Away',
    column_name: 'To Do',
    title,
    bucket: 'ready',
    assignee_ids: [me.id],
    waiting_user_ids: [],
    blocking: [],
    blocked_by: [],
    hidden_blocked_by_count: 0,
    hidden_blocking_count: 0,
  };
}

// The app shell owns the window listener, so the tests call the handler directly.
function press(key: string, init: KeyboardEventInit = {}): void {
  shortcuts.handleKeydown(new KeyboardEvent('keydown', { key, cancelable: true, ...init }));
}

function loadOpenBoard(tasks: BoardTask[]): void {
  const data = payload(OPEN_PROJECT, 'Rulebook', tasks);
  board.currentProjectId = OPEN_PROJECT;
  board.project = data.project;
  board.columns = data.columns;
  board.tasks = data.tasks;
  board.labels = data.labels;
}

/** My Tasks holding one card that lives in a project the open board is not showing. */
function standOnMyTasks(): void {
  projects.projects = [projectRow(AWAY_PROJECT, 'Away')];
  myTasks.tasks = [myTask(AWAY_TASK, AWAY_PROJECT, 'Ship the demo')];
  router.navigate('/my-tasks', { replace: true });
  cardCursor.setRows([AWAY_TASK]);
  cardCursor.set(AWAY_TASK);
}

function mockAwayApi(
  tasks: BoardTask[] = [task(AWAY_TASK, `${AWAY_PROJECT}-todo`, 'Ship the demo')]
) {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const url = new URL(request.url);
    if (url.pathname === '/api/users') {
      return jsonResponse(200, { users: [me, teammate] });
    }
    if (url.pathname === `/api/projects/${AWAY_PROJECT}`) {
      return jsonResponse(200, payload(AWAY_PROJECT, 'Away', tasks));
    }
    return jsonResponse(200, {});
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, {}));
  board.reset();
  cardContext.reset();
  cardCursor.reset();
  myTasks.reset();
  projects.reset();
  selection.clear();
  shortcuts.reset();
  taskRoute.reset();
  users.reset();
  announcer.clear();
  session.user = me;
  router.navigate('/', { replace: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('quick menus on a project route', () => {
  beforeEach(() => {
    loadOpenBoard([task(T1, `${OPEN_PROJECT}-todo`, 'Design cards')]);
    router.navigate(projectHref(OPEN_PROJECT, 'Rulebook'), { replace: true });
  });

  it('opens the label menu for the board cursor with l', async () => {
    render(QuickMenus);
    selection.set(T1);

    press('l');

    expect(await screen.findByRole('heading', { level: 2, name: 'Labels' })).toBeInTheDocument();
    expect(shortcuts.labelMenu).toBe(T1);
    expect(screen.getByRole('button', { name: /Urgent/ })).toBeInTheDocument();
  });

  it('opens a focused blocked-by picker with b and links the task Enter chooses', async () => {
    board.tasks = [...board.tasks, task(T2, `${OPEN_PROJECT}-todo`, 'Cut cards', 2000)];
    render(QuickMenus);
    selection.set(T1);

    press('b');

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'Blocked by — Design cards',
    });
    expect(shortcuts.dependencyMenu).toEqual({ taskId: T1, direction: 'blocker' });

    const menu = heading.closest('dialog')!;
    const input = within(menu).getByLabelText<HTMLInputElement>('Search tasks that block this one');
    expect(input).toHaveFocus();

    const addBlocker = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
    await fireEvent.input(input, { target: { value: 'cut' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(addBlocker).toHaveBeenCalledWith(T1, T2);
  });

  it('opens the blocks picker with Shift+B', async () => {
    render(QuickMenus);
    selection.set(T1);

    press('B', { shiftKey: true });

    const heading = await screen.findByRole('heading', { level: 2, name: 'Blocks — Design cards' });
    expect(shortcuts.dependencyMenu).toEqual({ taskId: T1, direction: 'blocked' });
    expect(
      within(heading.closest('dialog')!).getByLabelText('Search tasks this one blocks')
    ).toHaveFocus();
  });

  // The palette seeds this one with free text the user typed, and a menu the user
  // dismisses on its own never reaches closeMenus(): the seed left behind would
  // narrow whatever menu is opened next.
  it('opens the label menu narrowed to a seeded query and drops the seed when dismissed', async () => {
    render(QuickMenus);

    shortcuts.menuPrefill = 'Urgent';
    shortcuts.labelMenu = T1;

    const heading = await screen.findByRole('heading', { level: 2, name: 'Labels' });
    const menu = heading.closest('dialog')!;
    expect(within(menu).getByLabelText<HTMLInputElement>('Filter labels').value).toBe('Urgent');

    // Clicking the backdrop, not closeMenus(): the dialog's own dismissal.
    await fireEvent.click(menu);

    await waitFor(() => {
      expect(shortcuts.labelMenu).toBeNull();
    });
    expect(shortcuts.menuPrefill).toBe('');
  });

  it('closes the label menu when its card is deleted under it', async () => {
    render(QuickMenus);
    selection.set(T1);

    press('l');
    await screen.findByRole('heading', { level: 2, name: 'Labels' });

    board.tasks = board.tasks.filter((t) => t.id !== T1);

    // A row here PUTs the card's labels, so an open menu over a deleted card
    // offers a click that can only end in an error toast and a refetch.
    await waitFor(() => {
      expect(shortcuts.labelMenu).toBeNull();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('closes the dependency picker when its card is deleted under it', async () => {
    render(QuickMenus);
    selection.set(T1);

    press('b');
    await screen.findByRole('heading', { level: 2, name: 'Blocked by — Design cards' });

    board.tasks = board.tasks.filter((t) => t.id !== T1);

    await waitFor(() => {
      expect(shortcuts.dependencyMenu).toBeNull();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('opens the move menu narrowed to a seeded column and drops the seed after', async () => {
    vi.spyOn(board, 'moveTask');
    render(QuickMenus);

    shortcuts.menuPrefill = 'Done';
    shortcuts.moveMenu = T1;

    const heading = await screen.findByRole('heading', { level: 2, name: 'Move — Design cards' });
    const menu = heading.closest('dialog')!;
    expect(within(menu).getByLabelText<HTMLInputElement>('Search columns').value).toBe('Done');

    await fireEvent.click(within(menu).getByRole('button', { name: /^Done/ }));

    await waitFor(() => {
      expect(shortcuts.moveMenu).toBeNull();
    });
    expect(shortcuts.menuPrefill).toBe('');
  });

  it('moves the board cursor through the m menu and announces where it landed', async () => {
    board.tasks = [
      ...board.tasks,
      task(T2, `${OPEN_PROJECT}-done`, 'Cut cards', 1000),
      task(testUuid('t3'), `${OPEN_PROJECT}-done`, 'Print rules', 2000),
    ];
    const moveTask = vi.spyOn(board, 'moveTask');
    render(QuickMenus);
    selection.set(T1);

    press('m');

    const heading = await screen.findByRole('heading', { level: 2, name: 'Move — Design cards' });
    const menu = heading.closest('dialog')!;
    expect(within(menu).getByLabelText('Search columns')).toHaveFocus();

    await fireEvent.click(within(menu).getByRole('button', { name: /^Done/ }));
    await fireEvent.click(within(menu).getByRole('button', { name: /^Bottom/ }));

    expect(moveTask).toHaveBeenCalledWith(
      T1,
      `${OPEN_PROJECT}-done`,
      { sort_key: expect.any(String) },
      { kind: 'between', afterId: testUuid('t3'), beforeId: null }
    );
    expect(shortcuts.moveMenu).toBeNull();
    // The store, not a region: Announcer takes its text as a prop now, so the
    // wiring that puts it on screen belongs to the shell and is asserted there.
    await waitFor(() => {
      expect(announcer.message).toBe('Moved "Design cards" to Done, position 3 of 3');
    });
  });

  it('mounts a bulk surface only while one is asked for', async () => {
    board.tasks = [...board.tasks, task(T2, `${OPEN_PROJECT}-todo`, 'Cut cards', 2000)];
    render(QuickMenus);
    selection.toggle(T1);
    selection.toggle(T2);
    expect(screen.queryByRole('dialog')).toBeNull();

    shortcuts.bulkMenu = 'archive';
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveAccessibleName('Archive cards');
    });

    shortcuts.bulkMenu = null;
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  // The bug this whole surface exists to prevent: an open menu state with nothing
  // rendering it leaves the keymap swallowing every key but Escape.
  it('puts a dismissible surface up while the board it needs is still loading', async () => {
    board.reset();
    board.currentProjectId = OPEN_PROJECT;
    render(QuickMenus);

    shortcuts.labelMenu = T1;

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Loading…');
    expect(within(dialog).getByLabelText('Loading')).toBeInTheDocument();

    press('Escape');
    await waitFor(() => {
      expect(shortcuts.labelMenu).toBeNull();
    });
  });

  it('offers a way out when the board it needs failed to load', async () => {
    board.reset();
    board.currentProjectId = OPEN_PROJECT;
    board.error = 'Failed to load board';
    render(QuickMenus);

    shortcuts.moveMenu = T1;

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('That card is out of reach');

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(shortcuts.moveMenu).toBeNull();
  });
});

describe('quick menus for a card outside the open board', () => {
  beforeEach(() => {
    standOnMyTasks();
    mockAwayApi();
  });

  it('loads the target project and labels the card with the labels it holds', async () => {
    render(QuickMenus);

    press('l');

    expect(await screen.findByRole('heading', { level: 2, name: 'Labels' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Urgent/ })).toBeInTheDocument();
    });
    expect(awayBoard.currentProjectId).toBe(AWAY_PROJECT);
    // Never the open board: the screen behind must survive acting on a card
    // that is not on it.
    expect(board.currentProjectId).toBeNull();

    const setTaskLabels = vi.spyOn(awayBoard, 'setTaskLabels');
    await fireEvent.click(screen.getByRole('button', { name: /Urgent/ }));

    expect(setTaskLabels).toHaveBeenCalledWith(AWAY_TASK, [`${AWAY_PROJECT}-lab`]);
  });

  it('moves the card into a column of its own project', async () => {
    const moveTask = vi.spyOn(awayBoard, 'moveTask');
    render(QuickMenus);

    press('m');

    const heading = await screen.findByRole('heading', { level: 2, name: 'Move — Ship the demo' });
    const menu = heading.closest('dialog')!;
    await fireEvent.click(within(menu).getByRole('button', { name: /^Done/ }));

    expect(moveTask).toHaveBeenCalledWith(
      AWAY_TASK,
      `${AWAY_PROJECT}-done`,
      { sort_key: expect.any(String) },
      { kind: 'append' }
    );
  });

  it('lists the target project members rather than the open board members', async () => {
    render(QuickMenus);

    press('a');

    expect(await screen.findByRole('heading', { level: 2, name: 'Assignees' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Bo/ })).toBeInTheDocument();
    });
    const userRequests = fetchMock.mock.calls
      .map((call) => new URL((call[0] as Request).url))
      .filter((url) => url.pathname === '/api/users');
    expect(userRequests.map((url) => url.searchParams.get('project_id'))).toContain(AWAY_PROJECT);
  });

  it('searches the target project for a blocker, not the open board', async () => {
    mockAwayApi([
      task(AWAY_TASK, `${AWAY_PROJECT}-todo`, 'Ship the demo'),
      task(T2, `${AWAY_PROJECT}-todo`, 'Cut the trailer', 2000),
    ]);
    render(QuickMenus);

    press('b');

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'Blocked by — Ship the demo',
    });
    const input = within(heading.closest('dialog')!).getByLabelText<HTMLInputElement>(
      'Search tasks that block this one'
    );
    const addBlocker = vi.spyOn(awayBoard, 'addBlocker').mockResolvedValue(true);
    await fireEvent.input(input, { target: { value: 'trailer' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(addBlocker).toHaveBeenCalledWith(AWAY_TASK, T2);
  });

  it('says so rather than going quiet when the target project cannot be read', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'boom' }));
    render(QuickMenus);

    press('l');

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog).toHaveAccessibleName('That card is out of reach');
    });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(shortcuts.labelMenu).toBeNull();
  });

  it('recovers on Try again without making the user close and re-open the menu', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'boom' }));
    render(QuickMenus);

    press('l');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog).toHaveAccessibleName('That card is out of reach');
    });

    mockAwayApi();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Labels' })).toBeInTheDocument();
  });

  // The away board has no filters of its own, and its response can land after the
  // user has walked onto the very project it was fetching.
  it('never rewrites the filter query of the screen the user ends up on', async () => {
    render(QuickMenus);

    press('l');
    await screen.findByRole('heading', { level: 2, name: 'Labels' });
    shortcuts.closeMenus();

    const filtered = `${projectHref(AWAY_PROJECT, 'Away')}?q=boss`;
    router.navigate(filtered, { replace: true });
    await awayBoard.refetch();

    expect(router.path).toBe(filtered);
  });

  it('refuses the keys entirely on a board the user may only read', async () => {
    projects.projects = [
      {
        ...projectRow(AWAY_PROJECT, 'Away'),
        created_by: 'u-owner',
        member_ids: [me.id],
        members: [{ user_id: me.id, role: 'viewer' }],
      },
    ];
    render(QuickMenus);

    press('l');
    press('m');
    press('a');

    expect(shortcuts.anyMenuOpen).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves the away board alone once the cursor moves back onto the open one', async () => {
    render(QuickMenus);

    press('l');
    await screen.findByRole('heading', { level: 2, name: 'Labels' });
    shortcuts.closeMenus();
    // The dialog outlives the state by a flush, and an open one owns the keymap.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    loadOpenBoard([task(T1, `${OPEN_PROJECT}-todo`, 'Design cards')]);
    router.navigate(projectHref(OPEN_PROJECT, 'Rulebook'), { replace: true });
    selection.set(T1);
    press('l');

    await waitFor(() => {
      expect(shortcuts.labelMenu).toBe(T1);
    });
    expect(cardContext.storeFor(T1)).toBe(board);
  });
});

describe('the palette in the shell', () => {
  it('offers the card actions for the cursor on my tasks', async () => {
    standOnMyTasks();
    mockAwayApi();
    render(QuickMenus);

    shortcuts.paletteOpen = true;

    expect(await screen.findByRole('combobox', { name: 'Command palette' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Labels…/ })).toBeInTheDocument();
    });
    expect(screen.getByRole('group', { name: 'Actions — Ship the demo' })).toBeInTheDocument();
  });

  it('teaches the cursor keys when a list screen has nothing pointed at', async () => {
    standOnMyTasks();
    cardCursor.clear();
    mockAwayApi();
    render(QuickMenus);

    shortcuts.paletteOpen = true;

    await screen.findByRole('combobox', { name: 'Command palette' });
    expect(screen.getByText('Select a card with')).toBeInTheDocument();
  });

  it('hands a card action off to the quick menu it names', async () => {
    standOnMyTasks();
    mockAwayApi();
    render(QuickMenus);

    shortcuts.paletteOpen = true;
    await screen.findByRole('combobox', { name: 'Command palette' });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Labels…/ })).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByRole('option', { name: /Labels…/ }));

    await waitFor(() => {
      expect(shortcuts.labelMenu).toBe(AWAY_TASK);
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'Labels' })).toBeInTheDocument();
  });
});

describe('the list cursor', () => {
  beforeEach(() => {
    standOnMyTasks();
    mockAwayApi();
  });

  it('walks the rows with j and k and clears on Escape', () => {
    const second = testUuid('t-away-2');
    cardCursor.setRows([AWAY_TASK, second]);
    cardCursor.clear();

    press('j');
    expect(cardCursor.taskId).toBe(AWAY_TASK);
    press('j');
    expect(cardCursor.taskId).toBe(second);
    press('k');
    expect(cardCursor.taskId).toBe(AWAY_TASK);
    press('Escape');
    expect(cardCursor.taskId).toBeNull();
  });

  it('drops a cursor whose row the next payload no longer holds', () => {
    expect(cardCursor.taskId).toBe(AWAY_TASK);

    cardCursor.setRows([testUuid('t-other')]);

    expect(cardCursor.taskId).toBeNull();
  });

  it('leaves a link with a modifier held to the browser', () => {
    cardCursor.clear();

    press('j', { metaKey: true });

    expect(cardCursor.taskId).toBeNull();
  });
});
