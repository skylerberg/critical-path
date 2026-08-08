import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { mount, tick, unmount } from 'svelte';
import Project from './Project.svelte';
import ProjectRoute from './ProjectRoute.svelte';
import QuickMenus from '../components/QuickMenus.svelte';
import { announcer } from '../lib/announcer.svelte';
import { board } from '../lib/board.svelte';
import { noFilters } from '../lib/board-filters';
import { drafts } from '../lib/drafts.svelte';
import { router } from '../lib/router.svelte';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';
import { shortcuts } from '../lib/shortcuts.svelte';
import { users } from '../lib/users.svelte';
import type { BoardPayload, BoardTask } from '../lib/board-types';
import { encodeId, projectHref, taskHref } from '../lib/short-links';
import { taskRoute } from '../lib/task-route.svelte';
import { testUuid } from '../lib/test-ids';
import type { ProjectView } from '../lib/router.svelte';

const me = {
  id: 'u-me',
  name: 'Ada',
  email: 'ada@example.com',
  avatar_url: null,
  email_verified: false,
};

const T1 = testUuid('t1');
const T2 = testUuid('t2');
const T3 = testUuid('t3');
const T9 = testUuid('t9');
const PROJECT_NAME = 'Rulebook';

// The slug follows the live title, exactly as the component builds it.
function titleOf(taskId: string): string {
  return board.tasks.find((t) => t.id === taskId)?.title ?? '';
}

// The app shell owns the window listener, so these call the handler directly. The
// shortcut layer reads the live route, so they must still drive the router to the same
// view/overlay the component is rendered with: navigating rather than assigning
// `router.current` keeps `router.path` on the project, which is what a filter key
// then rewrites.
function pressKey(
  key: string,
  id: string,
  view: ProjectView,
  taskId?: string,
  init: KeyboardEventInit = {}
): void {
  const path =
    taskId === undefined
      ? projectHref(id, PROJECT_NAME, view)
      : taskHref(taskId, titleOf(taskId), view);
  router.navigate(path + board.filterSearch, { replace: true });
  shortcuts.handleKeydown(new KeyboardEvent('keydown', { key, cancelable: true, ...init }));
}

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
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  };
}

// Extra `users` lets one mock answer both the board fetch and the project-scoped
// users fetch the project shell fires on load.
function payload(projectId: string, tasks: BoardTask[]): BoardPayload & { users: [] } {
  return {
    users: [],
    project: {
      id: projectId,
      name: PROJECT_NAME,
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
      { id: 'todo', name: 'To Do', sort_key: 'V0000010001', is_done: false },
      { id: 'done', name: 'Done', sort_key: 'V0000020001', is_done: true },
    ],
    tasks,
    labels: [],
    changed_task_ids: [],
  };
}

function mockProjectApi(projectId: string, tasks: BoardTask[]): void {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.endsWith('/activity')) {
      return jsonResponse(200, { activity: [] });
    }
    const taskMatch = /^\/api\/tasks\/(.+)$/.exec(url.pathname);
    if (request.method === 'GET' && taskMatch) {
      const found = tasks.find((t) => t.id === taskMatch[1]);
      return jsonResponse(200, { ...found, project_id: projectId, images: [] });
    }
    return jsonResponse(200, payload(projectId, tasks));
  });
}

// A second root beside the route under test: the quick menus are the app shell's,
// not the project screen's, and a test that drives one needs both on screen.
function mountShell(): ReturnType<typeof mount> {
  const target = document.createElement('div');
  document.body.append(target);
  return mount(QuickMenus, { target });
}

function requestedPaths(): string[] {
  return fetchMock.mock.calls.map((call) => {
    const url = new URL((call[0] as Request).url);
    return `${url.pathname}${url.search}`;
  });
}

function mountOnRoute(): ReturnType<typeof mount> {
  const target = document.createElement('div');
  document.body.append(target);
  return mount(ProjectRoute, {
    target,
    props: {
      get projectId() {
        return router.current.name === 'project' ? router.current.params.projectId : null;
      },
      get view() {
        return router.current.name === 'project' ? router.current.params.view : 'board';
      },
      get taskId() {
        return router.current.name === 'project' ? router.current.params.taskId : undefined;
      },
      get filters() {
        return router.current.name === 'project' ? router.current.params.filters : noFilters();
      },
      get from() {
        return router.current.name === 'project' ? router.current.params.from : undefined;
      },
    },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  taskRoute.reset();
  drafts.clearAll();
  selection.clear();
  shortcuts.reset();
  users.reset();
  session.user = me;
  router.navigate('/', { replace: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Project', () => {
  it('renders the header and the board view by default', async () => {
    const projectId = testUuid('p-shell-board');
    mockProjectApi(projectId, [task(T1, 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'board' } });

    expect(await screen.findByRole('heading', { name: 'Rulebook' })).toBeInTheDocument();
    expect(screen.getByText('Design cards')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter tasks by title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add column' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Dependency graph')).not.toBeInTheDocument();
  });

  it('renders the graph view with the shared header and its filter bar', async () => {
    const projectId = testUuid('p-shell-graph');
    mockProjectApi(projectId, [task(T1, 'todo', 'Design cards')]);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    expect(await screen.findByRole('heading', { name: 'Rulebook' })).toBeInTheDocument();
    expect(screen.getByLabelText('Filter tasks by title')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-label="Dependency graph"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add column' })).not.toBeInTheDocument();
  });

  it('fetches project-scoped users on the graph view for the header assignee chips', async () => {
    const projectId = testUuid('p-shell-graph-users');
    mockProjectApi(projectId, [task(T1, 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'graph' } });

    await screen.findByRole('heading', { name: 'Rulebook' });
    await waitFor(() => {
      expect(requestedPaths()).toContain(`/api/users?project_id=${projectId}`);
    });
  });

  it('shows the error shell with retry and fetches exactly once on failure', async () => {
    const projectId = testUuid('p-shell-error');
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls += 1;
      return jsonResponse(503, { error: `down ${calls}` });
    });

    render(Project, { props: { projectId, view: 'graph' } });

    expect(await screen.findByText('down 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(requestedPaths().filter((path) => path === `/api/projects/${projectId}`)).toHaveLength(
      1
    );
  });

  it('opens the task overlay above the graph without leaving the graph view', async () => {
    const projectId = testUuid('p-shell-graph-task');
    mockProjectApi(projectId, [task(T1, 'todo', 'Design cards')]);

    const { container } = render(Project, {
      props: { projectId, view: 'graph', taskId: T1 },
    });

    expect(await screen.findByLabelText('Task title')).toHaveValue('Design cards');
    expect(container.querySelector('svg[aria-label="Dependency graph"]')).not.toBeNull();
    expect(container.querySelector('dialog')).not.toBeNull();
  });

  it('closes the overlay back to the graph base with replaceState', async () => {
    const projectId = testUuid('p-shell-graph-close');
    mockProjectApi(projectId, [task(T1, 'todo', 'Design cards')]);
    router.navigate(taskHref(T1, 'Design cards', 'graph'), { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');
      const pushState = vi.spyOn(window.history, 'pushState');
      await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(window.location.pathname).toBe(projectHref(projectId, PROJECT_NAME, 'graph'));
      expect(pushState).not.toHaveBeenCalled();
      pushState.mockRestore();
    } finally {
      void unmount(app);
    }
  });

  it('closes the overlay back to the board base from the board view', async () => {
    const projectId = testUuid('p-shell-board-close');
    mockProjectApi(projectId, [task(T1, 'todo', 'Design cards')]);
    router.navigate(taskHref(T1, 'Design cards'), { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');
      await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(window.location.pathname).toBe(projectHref(projectId, PROJECT_NAME));
    } finally {
      void unmount(app);
    }
  });

  it('scrolls the card created by quick-add into view', async () => {
    const projectId = testUuid('p-board-scroll');
    mockProjectApi(projectId, [task(T1, 'todo', 'Design cards')]);
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    render(Project, { props: { projectId, view: 'board' } });
    await screen.findByText('Design cards');

    const column = screen.getByRole('listitem', { name: 'To Do' });
    await fireEvent.click(within(column).getByRole('button', { name: '+ Add task' }));
    const input = within(column).getByLabelText('Task title');
    await fireEvent.input(input, { target: { value: 'Scroll target' } });
    await fireEvent.submit(input.closest('form')!);

    const created = board.tasks.find((t) => t.title === 'Scroll target');
    expect(created).toBeDefined();
    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    });
    const receiver = scrollSpy.mock.contexts[0] as Element;
    expect(receiver.getAttribute('data-task-id')).toBe(created!.id);
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(input).toHaveFocus();
  });

  it('keeps a half-typed quick-add title across a project switch', async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      const id = /^\/api\/projects\/(.+)$/.exec(new URL(request.url).pathname)?.[1];
      if (id === undefined) {
        return jsonResponse(200, { users: [] });
      }
      return jsonResponse(200, {
        ...payload(id, []),
        columns: [{ id: `${id}-todo`, name: 'To Do', position: 1000, is_done: false }],
      });
    });

    const view = render(Project, { props: { projectId: testUuid('p-draft-a'), view: 'board' } });
    await fireEvent.click(await screen.findByRole('button', { name: '+ Add task' }));
    await fireEvent.input(screen.getByLabelText('Task title'), { target: { value: 'Half typed' } });

    await view.rerender({ projectId: testUuid('p-draft-b'), view: 'board' });

    expect(await screen.findByRole('button', { name: '+ Add task' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();

    await view.rerender({ projectId: testUuid('p-draft-a'), view: 'board' });

    const restored = await waitFor(() => screen.getByLabelText('Task title'));
    expect(restored).toHaveValue('Half typed');
    expect(restored).not.toHaveFocus();
  });

  // The dialog itself is the app shell's; the shell route only has to route the key.
  it('routes ? to the shared help state', async () => {
    const projectId = testUuid('p-shell-board-keys');
    mockProjectApi(projectId, [task(T1, 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'board' } });

    await screen.findByRole('heading', { name: 'Rulebook' });
    pressKey('?', projectId, 'board');
    expect(shortcuts.helpOpen).toBe(true);
    expect(screen.queryByRole('heading', { level: 2, name: 'Keyboard shortcuts' })).toBeNull();
  });

  it('toggles the my-tasks filter with q and clears it with x from the board shell', async () => {
    const projectId = testUuid('p-shell-board-filter');
    mockProjectApi(projectId, [task(T1, 'todo', 'Design cards')]);
    users.users = [me];

    render(Project, { props: { projectId, view: 'board' } });
    await screen.findByRole('heading', { name: 'Rulebook' });

    pressKey('q', projectId, 'board');
    expect(board.filterAssigneeIds).toEqual([me.id]);
    expect(await screen.findByTitle('Filter by Ada')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();

    pressKey('x', projectId, 'board');
    expect(board.hasActiveFilters).toBe(false);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    });
  });

  it('clears an active filter with x from the graph shell', async () => {
    const projectId = testUuid('p-shell-graph-filter');
    mockProjectApi(projectId, [task(T1, 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'graph' } });
    await screen.findByRole('heading', { name: 'Rulebook' });

    board.setFilterQuery('boss');
    expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeInTheDocument();

    pressKey('x', projectId, 'graph');
    expect(board.filterQuery).toBe('');
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    });
  });

  it('leaves the filters alone when x is pressed behind the label manager', async () => {
    const projectId = testUuid('p-shell-board-modal');
    mockProjectApi(projectId, [task(T1, 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'board' } });
    await screen.findByRole('heading', { name: 'Rulebook' });

    board.setFilterQuery('boss');
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Labels' }));
    await screen.findByRole('heading', { level: 2, name: 'Labels' });

    pressKey('x', projectId, 'board');
    expect(board.filterQuery).toBe('boss');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  // jsdom implements neither showModal nor inertness, so only the presence of the
  // in-overlay region is checkable here; that it is the one spoken is manual.
  it('announces a move made from the graph overlay inside the overlay dialog', async () => {
    const projectId = testUuid('p-shell-graph-move');
    mockProjectApi(projectId, [
      task(T1, 'todo', 'Design cards'),
      task(T2, 'done', 'Cut cards', 1000),
      task(T3, 'done', 'Print rules', 2000),
    ]);
    const moveTask = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    const menus = mountShell();

    try {
      render(Project, { props: { projectId, view: 'graph', taskId: T1 } });

      await screen.findByLabelText('Task title');
      pressKey('m', projectId, 'graph', T1);

      const heading = await screen.findByRole('heading', { level: 2, name: 'Move — Design cards' });
      const menu = heading.closest('dialog')!;
      await fireEvent.click(within(menu).getByRole('button', { name: /^Done/ }));
      await fireEvent.click(within(menu).getByRole('button', { name: /^Top/ }));

      expect(moveTask).toHaveBeenCalledWith(T1, 'done', {
        sort_key: expect.any(String),
      });
      const overlay = screen.getByLabelText('Task title').closest('dialog')!;
      await waitFor(() => {
        expect(
          within(overlay)
            .getAllByRole('status')
            .map((region) => region.textContent)
        ).toContain('Moved "Design cards" to Done, position 1 of 3');
      });
    } finally {
      void unmount(menus);
    }
  });

  it('clears a stale announcement when the shell switches project', async () => {
    fetchMock.mockImplementation(async (input) => {
      const id = /^\/api\/projects\/(.+)$/.exec(new URL((input as Request).url).pathname)?.[1];
      if (id === undefined) {
        return jsonResponse(200, { users: [] });
      }
      return jsonResponse(200, payload(id, [task(T1, 'todo', 'Design cards')]));
    });

    const projectId = testUuid('p-shell-announcer-clear');
    const view = render(Project, { props: { projectId, view: 'board' } });
    await screen.findByText('Design cards');
    await announcer.announce('Moved "Design cards" to Done, position 3 of 3');

    await view.rerender({ projectId: testUuid('p-shell-announcer-next'), view: 'board' });

    await waitFor(() => {
      expect(announcer.message).toBe('');
    });
  });
});

describe('Project filters from the URL', () => {
  it('narrows the board to the filters the URL arrived with', async () => {
    const projectId = testUuid('p-url-filter-mount');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight'), task(T2, 'todo', 'Credits')]);
    router.navigate(`${projectHref(projectId, PROJECT_NAME)}?q=boss`, { replace: true });

    render(Project, {
      props: {
        projectId,
        view: 'board',
        filters: { labelIds: [], assigneeIds: [], query: 'boss' },
      },
    });

    await screen.findByRole('heading', { name: 'Rulebook' });
    expect(board.filterQuery).toBe('boss');
    expect(screen.getByLabelText<HTMLInputElement>('Filter tasks by title')).toHaveValue('boss');
    expect(screen.getByRole('link', { name: /Boss fight/ })).toHaveAttribute(
      'href',
      `${taskHref(T1, 'Boss fight')}?q=boss`
    );
  });

  it('re-narrows the board when Back lands on an entry with different filters', async () => {
    const projectId = testUuid('p-url-filter-back');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight'), task(T2, 'todo', 'Credits')]);
    router.navigate(`${projectHref(projectId, PROJECT_NAME)}?q=boss`, { replace: true });

    const view = render(Project, {
      props: {
        projectId,
        view: 'board',
        filters: { labelIds: [], assigneeIds: [], query: 'boss' },
      },
    });
    await screen.findByRole('heading', { name: 'Rulebook' });

    await view.rerender({
      projectId,
      view: 'board',
      filters: { labelIds: [], assigneeIds: [], query: 'credits' },
    });

    expect(board.filterQuery).toBe('credits');
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Filter tasks by title')).toHaveValue(
        'credits'
      );
    });
    expect(router.path).toBe(`${projectHref(projectId, PROJECT_NAME)}?q=credits`);
  });

  it('closes the task overlay back to the filtered board', async () => {
    const projectId = testUuid('p-url-filter-close');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(`${taskHref(T1, 'Boss fight')}?q=boss`, { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');
      await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(router.path).toBe(`${projectHref(projectId, PROJECT_NAME)}?q=boss`);
    } finally {
      void unmount(app);
    }
  });
});

describe('canonical URL', () => {
  it('replaces a wrong slug with the real one and adds no history entry', async () => {
    const projectId = testUuid('p-canon-slug');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(`/t/${encodeId(T1)}/completely-wrong-slug`, { replace: true });

    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');
      await waitFor(() => {
        expect(router.path).toBe(taskHref(T1, 'Boss fight'));
      });
      // A pushState canonicaliser looks identical on screen and breaks Back.
      expect(pushState).not.toHaveBeenCalled();
      expect(replaceState).toHaveBeenCalledTimes(1);
    } finally {
      void unmount(app);
    }
  });

  it('adds the missing slug to a slugless link', async () => {
    const projectId = testUuid('p-canon-bare');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(`/p/${encodeId(projectId)}`, { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByRole('heading', { name: PROJECT_NAME });
      await waitFor(() => {
        expect(router.path).toBe(projectHref(projectId, PROJECT_NAME));
      });
    } finally {
      void unmount(app);
    }
  });

  it('settles after one rewrite when the title slugifies to nothing', async () => {
    const projectId = testUuid('p-canon-empty');
    mockProjectApi(projectId, [task(T1, 'todo', '★★★')]);
    router.navigate(`/t/${encodeId(T1)}`, { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');
      await waitFor(() => {
        expect(router.path).toBe(`/t/${encodeId(T1)}/-`);
      });

      const replaceState = vi.spyOn(window.history, 'replaceState');
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(replaceState).not.toHaveBeenCalled();
    } finally {
      void unmount(app);
    }
  });

  it('re-slugs live when a teammate renames the open card', async () => {
    const projectId = testUuid('p-canon-task-rename');
    // Mutated in place so the overlay's own refetch agrees with the event rather
    // than restoring the old title underneath it.
    const tasks = [task(T1, 'todo', 'Boss fight')];
    mockProjectApi(projectId, tasks);
    router.navigate(taskHref(T1, 'Boss fight'), { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');
      // The board's revalidation must land first, or its in-flight response
      // overwrites the event with the title it was built from.
      await new Promise((resolve) => setTimeout(resolve, 30));

      tasks[0] = task(T1, 'todo', 'Final boss fight');
      board.applyRealtime({
        type: 'task_updated',
        project_id: projectId,
        data: { ...tasks[0] },
      } as never);

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(board.tasks.find((t) => t.id === T1)?.title).toBe('Final boss fight');
      expect(router.path).toBe(taskHref(T1, 'Final boss fight'));
    } finally {
      void unmount(app);
    }
  });

  it('re-slugs live when a teammate renames the project', async () => {
    const projectId = testUuid('p-canon-project-rename');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(projectHref(projectId, PROJECT_NAME), { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByRole('heading', { name: PROJECT_NAME });

      board.applyRealtime({
        type: 'project_updated',
        project_id: projectId,
        data: { name: 'Playbook' },
      } as never);

      await waitFor(() => {
        expect(router.path).toBe(projectHref(projectId, 'Playbook'));
      });
    } finally {
      void unmount(app);
    }
  });

  it('leaves the URL alone for a card the board payload does not hold', async () => {
    const projectId = testUuid('p-canon-archived');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    const archivedPath = `/t/${encodeId(T9)}`;
    router.navigate(archivedPath, { replace: true });

    const app = mountOnRoute();
    try {
      await waitFor(() => {
        expect(board.currentProjectId).toBe(projectId);
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(router.path).toBe(archivedPath);
    } finally {
      void unmount(app);
    }
  });

  it('rewrites only the pathname, leaving the filter query string alone', async () => {
    const projectId = testUuid('p-canon-filters');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(`/p/${encodeId(projectId)}/stale?q=boss`, { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByRole('heading', { name: PROJECT_NAME });
      await waitFor(() => {
        expect(router.path).toBe(`${projectHref(projectId, PROJECT_NAME)}?q=boss`);
      });
      expect(board.filterQuery).toBe('boss');
    } finally {
      void unmount(app);
    }
  });

  it('still syncs filter edits to the URL while an overlay is open on a task URL', async () => {
    const projectId = testUuid('p-canon-overlay-filter');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(taskHref(T1, 'Boss fight'), { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');

      board.setFilterQuery('boss');

      await waitFor(() => {
        expect(router.path).toBe(`${taskHref(T1, 'Boss fight')}?q=boss`);
      });
    } finally {
      void unmount(app);
    }
  });
});

// Mounting with getter props reproduces how the app passes the route down: an effect
// that reads a prop directly depends on the whole route object, which is replaced on
// every query-string rewrite.
describe('Project mounted on the live route', () => {
  it('restores the filters of the history entry Back lands on', async () => {
    const projectId = testUuid('p-route-back');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(`${projectHref(projectId, PROJECT_NAME)}?q=boss`, { replace: true });

    const app = mountOnRoute();
    try {
      await waitFor(() => {
        expect(board.filterQuery).toBe('boss');
      });

      window.history.pushState(null, '', projectHref(projectId, PROJECT_NAME));
      window.dispatchEvent(new PopStateEvent('popstate'));

      await waitFor(() => {
        expect(board.hasActiveFilters).toBe(false);
      });
    } finally {
      void unmount(app);
    }
  });

  // The board's filter rewrite runs on mount and owns the query string, so the return
  // path only survives if that rewrite leaves the keys it does not own alone.
  it('keeps the my-tasks return path through mount and closes back to it', async () => {
    const projectId = testUuid('p-route-from');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(`${taskHref(T1, 'Boss fight')}?from=my-tasks`, { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');
      expect(router.path).toBe(`${taskHref(T1, 'Boss fight')}?from=my-tasks`);

      await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(window.location.pathname).toBe('/my-tasks');
      expect(router.path).toBe('/my-tasks');
    } finally {
      void unmount(app);
    }
  });

  it('keeps the return path alongside a filter the board writes', async () => {
    const projectId = testUuid('p-route-from-filter');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(`${taskHref(T1, 'Boss fight')}?from=my-tasks`, { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');

      board.setFilterQuery('boss');

      expect(router.path).toBe(`${taskHref(T1, 'Boss fight')}?q=boss&from=my-tasks`);
      await tick();
      expect(router.current.name === 'project' && router.current.params.from).toBe('my-tasks');
    } finally {
      void unmount(app);
    }
  });

  it('opens the copy on a real route that keeps the active filter', async () => {
    const projectId = testUuid('p-route-duplicate-filter');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(`${taskHref(T1, 'Boss fight')}?q=boss`, { replace: true });
    vi.spyOn(board, 'duplicateTask').mockImplementation(async () => {
      board.tasks = [...board.tasks, task(T9, 'todo', 'Boss fight')];
      return T9;
    });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');
      await fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

      await waitFor(() => {
        expect(router.path).toBe(`${taskHref(T9, 'Boss fight')}?q=boss`);
      });
      expect(router.current.name === 'project' && router.current.params.taskId).toBe(T9);
      expect(board.filterQuery).toBe('boss');
    } finally {
      void unmount(app);
    }
  });

  it('opens the copy on a real route that keeps the my-tasks return path', async () => {
    const projectId = testUuid('p-route-duplicate-from');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(`${taskHref(T1, 'Boss fight')}?from=my-tasks`, { replace: true });
    vi.spyOn(board, 'duplicateTask').mockImplementation(async () => {
      board.tasks = [...board.tasks, task(T9, 'todo', 'Boss fight')];
      return T9;
    });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');
      await fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

      await waitFor(() => {
        expect(router.path).toBe(`${taskHref(T9, 'Boss fight')}?from=my-tasks`);
      });
      expect(router.current.name === 'project' && router.current.params.taskId).toBe(T9);

      await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(router.path).toBe('/my-tasks');
    } finally {
      void unmount(app);
    }
  });

  it('closes a quick menu when the route leaves the task it points at', async () => {
    const projectId = testUuid('p-route-menu');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(taskHref(T1, 'Boss fight'), { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');
      shortcuts.labelMenu = T1;

      router.navigate(projectHref(projectId, PROJECT_NAME));

      await waitFor(() => {
        expect(shortcuts.labelMenu).toBeNull();
      });
    } finally {
      void unmount(app);
    }
  });

  it('drops the selection when a card overlay opens', async () => {
    const projectId = testUuid('p-route-bulk-clear');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(projectHref(projectId, PROJECT_NAME), { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByText('Boss fight');
      selection.toggle(T1);
      expect(selection.selectedIds).toEqual([T1]);

      router.navigate(taskHref(T1, 'Boss fight'));

      await waitFor(() => {
        expect(selection.selectedIds).toEqual([]);
      });
    } finally {
      void unmount(app);
    }
  });

  it('keeps the board selection through a filter-only rewrite', async () => {
    const projectId = testUuid('p-route-selection');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(projectHref(projectId, PROJECT_NAME), { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByText('Boss fight');
      selection.set(T1);

      board.setFilterQuery('boss');
      expect(router.path).toBe(`${projectHref(projectId, PROJECT_NAME)}?q=boss`);
      await tick();

      expect(selection.cursorTaskId).toBe(T1);
    } finally {
      void unmount(app);
    }
  });

  it('revalidates the board when the route moves within the project', async () => {
    const projectId = testUuid('p-route-revalidate');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(projectHref(projectId, PROJECT_NAME), { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByText('Boss fight');
      const boardFetches = requestedPaths().filter(
        (path) => path === `/api/projects/${projectId}`
      ).length;

      router.navigate(projectHref(projectId, PROJECT_NAME, 'graph'));

      await waitFor(() => {
        expect(
          requestedPaths().filter((path) => path === `/api/projects/${projectId}`)
        ).toHaveLength(boardFetches + 1);
      });
    } finally {
      void unmount(app);
    }
  });

  it('does not refetch the board when only the filters change', async () => {
    const projectId = testUuid('p-route-refetch');
    mockProjectApi(projectId, [task(T1, 'todo', 'Boss fight')]);
    router.navigate(projectHref(projectId, PROJECT_NAME), { replace: true });

    const app = mountOnRoute();

    try {
      await waitFor(() => {
        expect(board.project?.id).toBe(projectId);
      });
      const boardFetches = requestedPaths().filter(
        (path) => path === `/api/projects/${projectId}`
      ).length;

      board.setFilterQuery('boss');
      await waitFor(() => {
        expect(router.path).toBe(`${projectHref(projectId, PROJECT_NAME)}?q=boss`);
      });
      await tick();

      expect(requestedPaths().filter((path) => path === `/api/projects/${projectId}`)).toHaveLength(
        boardFetches
      );
    } finally {
      void unmount(app);
    }
  });
});

describe('Project shell for a viewer', () => {
  it('renders both views read-only and drops the task overlay write controls', async () => {
    const projectId = testUuid('p-viewer-shell');
    const tasks = [task(T1, 'todo', 'Design cards')];
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname.endsWith('/activity')) {
        return jsonResponse(200, { activity: [] });
      }
      if (request.method === 'GET' && url.pathname === `/api/tasks/t1`) {
        return jsonResponse(200, { ...tasks[0], project_id: projectId, images: [] });
      }
      const base = payload(projectId, tasks);
      return jsonResponse(200, {
        ...base,
        project: {
          ...base.project,
          created_by: 'u-owner',
          member_ids: [me.id],
          members: [{ user_id: me.id, role: 'viewer' }],
        },
      });
    });

    render(Project, { props: { projectId, view: 'board', taskId: T1 } });

    expect(await screen.findByText('View only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add column' })).toBeNull();
    expect(screen.queryByLabelText('Task title')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete task' })).toBeNull();
    // The identity-backed half of the overlay survives the demotion.
    expect(screen.getByText(/^Comments \(/)).toBeInTheDocument();
  });
});

describe('Project entry captures what changed', () => {
  function mockBoardWithChanged(projectId: string, tasks: BoardTask[], changed: string[]): void {
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      const url = new URL(request.url);
      if (url.pathname.endsWith('/activity')) {
        return jsonResponse(200, { activity: [] });
      }
      if (request.method === 'PUT') {
        return jsonResponse(204);
      }
      return jsonResponse(200, { ...payload(projectId, tasks), changed_task_ids: changed });
    });
  }

  it('highlights only the cards the payload names, and stamps the marker', async () => {
    const projectId = testUuid('p-seen-entry');
    const tasks = [task(T1, 'todo', 'Moved by a teammate'), task(T2, 'todo', 'Untouched', 2000)];
    mockBoardWithChanged(projectId, tasks, [T1]);

    render(Project, { props: { projectId, view: 'board' } });

    expect(await screen.findByText('Moved by a teammate')).toBeInTheDocument();
    expect(screen.getByText('Untouched')).toBeInTheDocument();
    expect(screen.getAllByText('Changed since you last looked')).toHaveLength(1);
    await waitFor(() => expect(requestedPaths()).toContain(`/api/projects/${projectId}/seen`));
  });
});
