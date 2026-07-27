import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { mount, tick, unmount } from 'svelte';
import Project from './Project.svelte';
import { board } from '../lib/board.svelte';
import { noFilters } from '../lib/board-filters';
import { drafts } from '../lib/drafts.svelte';
import { router } from '../lib/router.svelte';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';
import { shortcuts } from '../lib/shortcuts.svelte';
import { users } from '../lib/users.svelte';
import type { BoardPayload, BoardTask } from '../lib/board-types';
import type { ProjectView } from '../lib/router.svelte';

const me = { id: 'u-me', name: 'Ada', email: 'ada@example.com', avatar_url: null };

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
  const base = view === 'graph' ? `/projects/${id}/graph` : `/projects/${id}`;
  const path = taskId === undefined ? base : `${base}/tasks/${taskId}`;
  router.navigate(path + board.filterSearch, { replace: true });
  shortcuts.handleKeydown(new KeyboardEvent('keydown', { key, cancelable: true, ...init }));
}

function task(id: string, columnId: string, title: string, position = 1000): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    position,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    due_date: null,
    comment_count: 0,
  };
}

// Extra `users` lets one mock answer both the board fetch and the project-scoped
// users fetch the project shell fires on load.
function payload(projectId: string, tasks: BoardTask[]): BoardPayload & { users: [] } {
  return {
    users: [],
    project: {
      id: projectId,
      name: 'Rulebook',
      description: '',
      archived_at: null,
      created_by: null,
      member_ids: [],
      is_public: false,
      created_at: '2026-07-15T00:00:00Z',
    },
    columns: [
      { id: 'todo', name: 'To Do', position: 1000, is_done: false },
      { id: 'done', name: 'Done', position: 2000, is_done: true },
    ],
    tasks,
    labels: [],
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

function requestedPaths(): string[] {
  return fetchMock.mock.calls.map((call) => {
    const url = new URL((call[0] as Request).url);
    return `${url.pathname}${url.search}`;
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
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
    const projectId = 'p-shell-board';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'board' } });

    expect(await screen.findByRole('heading', { name: 'Rulebook' })).toBeInTheDocument();
    expect(screen.getByText('Design cards')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter tasks by title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add column' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Dependency graph')).not.toBeInTheDocument();
  });

  it('renders the graph view with the shared header and its filter bar', async () => {
    const projectId = 'p-shell-graph';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    expect(await screen.findByRole('heading', { name: 'Rulebook' })).toBeInTheDocument();
    expect(screen.getByLabelText('Filter tasks by title')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-label="Dependency graph"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add column' })).not.toBeInTheDocument();
  });

  it('fetches project-scoped users on the graph view for the header assignee chips', async () => {
    const projectId = 'p-shell-graph-users';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'graph' } });

    await screen.findByRole('heading', { name: 'Rulebook' });
    await waitFor(() => {
      expect(requestedPaths()).toContain(`/api/users?project_id=${projectId}`);
    });
  });

  it('shows the error shell with retry and fetches exactly once on failure', async () => {
    const projectId = 'p-shell-error';
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
    const projectId = 'p-shell-graph-task';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    const { container } = render(Project, {
      props: { projectId, view: 'graph', taskId: 't1' },
    });

    expect(await screen.findByLabelText('Task title')).toHaveValue('Design cards');
    expect(container.querySelector('svg[aria-label="Dependency graph"]')).not.toBeNull();
    expect(container.querySelector('dialog')).not.toBeNull();
  });

  it('closes the overlay back to the graph base with replaceState', async () => {
    const projectId = 'p-shell-graph-close';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'graph', taskId: 't1' } });

    await screen.findByLabelText('Task title');
    const pushState = vi.spyOn(window.history, 'pushState');
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(window.location.pathname).toBe(`/projects/${projectId}/graph`);
    expect(pushState).not.toHaveBeenCalled();
    pushState.mockRestore();
  });

  it('closes the overlay back to the board base from the board view', async () => {
    const projectId = 'p-shell-board-close';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'board', taskId: 't1' } });

    await screen.findByLabelText('Task title');
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(window.location.pathname).toBe(`/projects/${projectId}`);
  });

  it('scrolls the card created by quick-add into view', async () => {
    const projectId = 'p-board-scroll';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);
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

    const view = render(Project, { props: { projectId: 'p-draft-a', view: 'board' } });
    await fireEvent.click(await screen.findByRole('button', { name: '+ Add task' }));
    await fireEvent.input(screen.getByLabelText('Task title'), { target: { value: 'Half typed' } });

    await view.rerender({ projectId: 'p-draft-b', view: 'board' });

    expect(await screen.findByRole('button', { name: '+ Add task' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();

    await view.rerender({ projectId: 'p-draft-a', view: 'board' });

    const restored = await waitFor(() => screen.getByLabelText('Task title'));
    expect(restored).toHaveValue('Half typed');
    expect(restored).not.toHaveFocus();
  });

  // The dialog itself is the app shell's; the shell route only has to route the key.
  it('routes ? to the shared help state', async () => {
    const projectId = 'p-shell-board-keys';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'board' } });

    await screen.findByRole('heading', { name: 'Rulebook' });
    pressKey('?', projectId, 'board');
    expect(shortcuts.helpOpen).toBe(true);
    expect(screen.queryByRole('heading', { level: 2, name: 'Keyboard shortcuts' })).toBeNull();
  });

  it('toggles the my-tasks filter with q and clears it with x from the board shell', async () => {
    const projectId = 'p-shell-board-filter';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);
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
    const projectId = 'p-shell-graph-filter';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

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
    const projectId = 'p-shell-board-modal';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'board' } });
    await screen.findByRole('heading', { name: 'Rulebook' });

    board.setFilterQuery('boss');
    await fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
    await screen.findByRole('heading', { level: 2, name: 'Labels' });

    pressKey('x', projectId, 'board');
    expect(board.filterQuery).toBe('boss');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('opens the label menu for the open task from the graph overlay', async () => {
    const projectId = 'p-shell-graph-keys';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'graph', taskId: 't1' } });

    await screen.findByLabelText('Task title');
    pressKey('l', projectId, 'graph', 't1');
    expect(await screen.findByRole('heading', { level: 2, name: 'Labels' })).toBeInTheDocument();
    expect(shortcuts.labelMenu).toBe('t1');
  });

  it('opens a focused blocked-by picker for the board selection with b', async () => {
    const projectId = 'p-shell-board-blockers';
    mockProjectApi(projectId, [
      task('t1', 'todo', 'Design cards'),
      task('t2', 'todo', 'Cut cards'),
    ]);

    render(Project, { props: { projectId, view: 'board' } });

    await screen.findByText('Design cards');
    selection.set('t1');
    pressKey('b', projectId, 'board');

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'Blocked by — Design cards',
    });
    expect(shortcuts.dependencyMenu).toEqual({ taskId: 't1', direction: 'blocker' });

    const menu = heading.closest('dialog')!;
    const input = within(menu).getByLabelText<HTMLInputElement>('Search tasks that block this one');
    expect(input).toHaveFocus();

    const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);
    await fireEvent.input(input, { target: { value: 'cut' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(spy).toHaveBeenCalledWith('t1', 't2');
  });

  it('opens the blocks picker for the open task with Shift+B from the graph overlay', async () => {
    const projectId = 'p-shell-graph-blocks';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'graph', taskId: 't1' } });

    await screen.findByLabelText('Task title');
    pressKey('B', projectId, 'graph', 't1', { shiftKey: true });

    const heading = await screen.findByRole('heading', { level: 2, name: 'Blocks — Design cards' });
    expect(shortcuts.dependencyMenu).toEqual({ taskId: 't1', direction: 'blocked' });
    // The open task detail renders both pickers with the same aria-labels, so the
    // query has to be scoped to the quick menu's own dialog.
    const menu = heading.closest('dialog')!;
    expect(within(menu).getByLabelText('Search tasks this one blocks')).toHaveFocus();
  });

  it('moves the board selection through the m menu and announces where it landed', async () => {
    const projectId = 'p-shell-board-move';
    mockProjectApi(projectId, [
      task('t1', 'todo', 'Design cards'),
      task('t2', 'done', 'Cut cards', 1000),
      task('t3', 'done', 'Print rules', 2000),
    ]);
    const moveTask = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);

    render(Project, { props: { projectId, view: 'board' } });

    await screen.findByText('Design cards');
    selection.set('t1');
    pressKey('m', projectId, 'board');

    const heading = await screen.findByRole('heading', { level: 2, name: 'Move — Design cards' });
    const menu = heading.closest('dialog')!;
    expect(within(menu).getByLabelText('Search columns')).toHaveFocus();

    await fireEvent.click(within(menu).getByRole('button', { name: /^Done/ }));
    await fireEvent.click(within(menu).getByRole('button', { name: 'Bottom' }));

    expect(moveTask).toHaveBeenCalledWith('t1', 'done', 3000);
    expect(shortcuts.moveMenu).toBeNull();
    await waitFor(() => {
      expect(screen.getAllByRole('status').map((region) => region.textContent)).toContain(
        'Moved "Design cards" to Done, position 3 of 3'
      );
    });
  });

  // jsdom implements neither showModal nor inertness, so only the presence of the
  // in-overlay region is checkable here; that it is the one spoken is manual.
  it('announces a move made from the graph overlay inside the overlay dialog', async () => {
    const projectId = 'p-shell-graph-move';
    mockProjectApi(projectId, [
      task('t1', 'todo', 'Design cards'),
      task('t2', 'done', 'Cut cards', 1000),
      task('t3', 'done', 'Print rules', 2000),
    ]);
    const moveTask = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);

    render(Project, { props: { projectId, view: 'graph', taskId: 't1' } });

    await screen.findByLabelText('Task title');
    pressKey('m', projectId, 'graph', 't1');

    const heading = await screen.findByRole('heading', { level: 2, name: 'Move — Design cards' });
    const menu = heading.closest('dialog')!;
    await fireEvent.click(within(menu).getByRole('button', { name: /^Done/ }));
    await fireEvent.click(within(menu).getByRole('button', { name: 'Top' }));

    expect(moveTask).toHaveBeenCalledWith('t1', 'done', 0);
    const overlay = screen.getByLabelText('Task title').closest('dialog')!;
    await waitFor(() => {
      expect(
        within(overlay)
          .getAllByRole('status')
          .map((region) => region.textContent)
      ).toContain('Moved "Design cards" to Done, position 1 of 3');
    });
  });

  it('opens the move menu from the overlay Move… button', async () => {
    const projectId = 'p-shell-move-button';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'board', taskId: 't1' } });

    await screen.findByLabelText('Task title');
    await fireEvent.click(screen.getByRole('button', { name: 'Move…' }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Move — Design cards' })
    ).toBeInTheDocument();
  });
});

describe('Project filters from the URL', () => {
  it('narrows the board to the filters the URL arrived with', async () => {
    const projectId = 'p-url-filter-mount';
    mockProjectApi(projectId, [task('t1', 'todo', 'Boss fight'), task('t2', 'todo', 'Credits')]);
    router.navigate(`/projects/${projectId}?q=boss`, { replace: true });

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
      `/projects/${projectId}/tasks/t1?q=boss`
    );
  });

  it('re-narrows the board when Back lands on an entry with different filters', async () => {
    const projectId = 'p-url-filter-back';
    mockProjectApi(projectId, [task('t1', 'todo', 'Boss fight'), task('t2', 'todo', 'Credits')]);
    router.navigate(`/projects/${projectId}?q=boss`, { replace: true });

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
    expect(router.path).toBe(`/projects/${projectId}?q=credits`);
  });

  it('closes the task overlay back to the filtered board', async () => {
    const projectId = 'p-url-filter-close';
    mockProjectApi(projectId, [task('t1', 'todo', 'Boss fight')]);
    router.navigate(`/projects/${projectId}/tasks/t1?q=boss`, { replace: true });

    render(Project, {
      props: {
        projectId,
        view: 'board',
        taskId: 't1',
        filters: { labelIds: [], assigneeIds: [], query: 'boss' },
      },
    });

    await screen.findByLabelText('Task title');
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(router.path).toBe(`/projects/${projectId}?q=boss`);
  });
});

// Mounting with getter props reproduces how the app passes the route down: an effect
// that reads a prop directly depends on the whole route object, which is replaced on
// every query-string rewrite.
describe('Project mounted on the live route', () => {
  function mountOnRoute(): ReturnType<typeof mount> {
    const target = document.createElement('div');
    document.body.append(target);
    return mount(Project, {
      target,
      props: {
        get projectId() {
          return router.current.name === 'project' ? router.current.params.id : '';
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

  it('restores the filters of the history entry Back lands on', async () => {
    const projectId = 'p-route-back';
    mockProjectApi(projectId, [task('t1', 'todo', 'Boss fight')]);
    router.navigate(`/projects/${projectId}?q=boss`, { replace: true });

    const app = mountOnRoute();
    try {
      await waitFor(() => {
        expect(board.filterQuery).toBe('boss');
      });

      window.history.pushState(null, '', `/projects/${projectId}`);
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
    const projectId = 'p-route-from';
    mockProjectApi(projectId, [task('t1', 'todo', 'Boss fight')]);
    router.navigate(`/projects/${projectId}/tasks/t1?from=my-tasks`, { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');
      expect(router.path).toBe(`/projects/${projectId}/tasks/t1?from=my-tasks`);

      await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(window.location.pathname).toBe('/my-tasks');
      expect(router.path).toBe('/my-tasks');
    } finally {
      void unmount(app);
    }
  });

  it('keeps the return path alongside a filter the board writes', async () => {
    const projectId = 'p-route-from-filter';
    mockProjectApi(projectId, [task('t1', 'todo', 'Boss fight')]);
    router.navigate(`/projects/${projectId}/tasks/t1?from=my-tasks`, { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');

      board.setFilterQuery('boss');

      expect(router.path).toBe(`/projects/${projectId}/tasks/t1?q=boss&from=my-tasks`);
      await tick();
      expect(router.current.name === 'project' && router.current.params.from).toBe('my-tasks');
    } finally {
      void unmount(app);
    }
  });

  it('closes a quick menu when the route leaves the task it points at', async () => {
    const projectId = 'p-route-menu';
    mockProjectApi(projectId, [task('t1', 'todo', 'Boss fight')]);
    router.navigate(`/projects/${projectId}/tasks/t1`, { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByLabelText('Task title');
      shortcuts.labelMenu = 't1';

      router.navigate(`/projects/${projectId}`);

      await waitFor(() => {
        expect(shortcuts.labelMenu).toBeNull();
      });
    } finally {
      void unmount(app);
    }
  });

  it('keeps the board selection through a filter-only rewrite', async () => {
    const projectId = 'p-route-selection';
    mockProjectApi(projectId, [task('t1', 'todo', 'Boss fight')]);
    router.navigate(`/projects/${projectId}`, { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByText('Boss fight');
      selection.set('t1');

      board.setFilterQuery('boss');
      expect(router.path).toBe(`/projects/${projectId}?q=boss`);
      await tick();

      expect(selection.selectedTaskId).toBe('t1');
    } finally {
      void unmount(app);
    }
  });

  it('revalidates the board when the route moves within the project', async () => {
    const projectId = 'p-route-revalidate';
    mockProjectApi(projectId, [task('t1', 'todo', 'Boss fight')]);
    router.navigate(`/projects/${projectId}`, { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByText('Boss fight');
      const boardFetches = requestedPaths().filter(
        (path) => path === `/api/projects/${projectId}`
      ).length;

      router.navigate(`/projects/${projectId}/graph`);

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
    const projectId = 'p-route-refetch';
    mockProjectApi(projectId, [task('t1', 'todo', 'Boss fight')]);
    router.navigate(`/projects/${projectId}`, { replace: true });

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
        expect(router.path).toBe(`/projects/${projectId}?q=boss`);
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
