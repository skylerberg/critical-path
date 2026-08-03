import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { mount, unmount } from 'svelte';
import ProjectRoute from './ProjectRoute.svelte';
import { board } from '../lib/board.svelte';
import { noFilters } from '../lib/board-filters';
import { drafts } from '../lib/drafts.svelte';
import { router } from '../lib/router.svelte';
import { search } from '../lib/search.svelte';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';
import { shortcuts } from '../lib/shortcuts.svelte';
import { taskRoute } from '../lib/task-route.svelte';
import { users } from '../lib/users.svelte';
import { encodeId, projectHref, taskHref } from '../lib/short-links';
import { testUuid } from '../lib/test-ids';
import type { BoardPayload, BoardTask } from '../lib/board-types';

const me = {
  id: 'u-me',
  name: 'Ada',
  email: 'ada@example.com',
  avatar_url: null,
  email_verified: false,
};

const PROJECT_ID = testUuid('p-route');
const T1 = testUuid('t1');
const T2 = testUuid('t2');
const ARCHIVED_ID = testUuid('t-archived');
const PROJECT_NAME = 'Rulebook';

function task(id: string, title: string, position = 1000): BoardTask {
  return {
    id,
    column_id: 'todo',
    title,
    description: null,
    position,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    column_since: '2026-07-15T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
  };
}

function payload(tasks: BoardTask[]): BoardPayload & { users: [] } {
  return {
    users: [],
    project: {
      id: PROJECT_ID,
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
      { id: 'todo', name: 'To Do', position: 1000, is_done: false },
      { id: 'done', name: 'Done', position: 2000, is_done: true },
    ],
    tasks,
    labels: [],
    changed_task_ids: [],
  };
}

function mockApi(tasks: BoardTask[], taskLookup?: (id: string) => Response): void {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const url = new URL(request.url);
    if (url.pathname.endsWith('/activity')) {
      return jsonResponse(200, { activity: [] });
    }
    const taskMatch = /^\/api\/tasks\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'GET' && taskMatch) {
      const id = taskMatch[1]!;
      if (taskLookup) {
        return taskLookup(id);
      }
      const found = tasks.find((t) => t.id === id);
      return found === undefined
        ? jsonResponse(404, { error: 'Task not found' })
        : jsonResponse(200, { ...found, project_id: PROJECT_ID, images: [] });
    }
    return jsonResponse(200, payload(tasks));
  });
}

function requestedPaths(): string[] {
  return fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
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
  search.reset();
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

describe('a cold task link', () => {
  it('resolves the project in one lookup, then loads that board', async () => {
    mockApi([task(T1, 'Boss fight')]);
    router.navigate(taskHref(T1, 'boss-fight'), { replace: true });

    const app = mountOnRoute();
    try {
      expect(await screen.findByLabelText('Task title')).toHaveValue('Boss fight');
      // The lookup has to come first: the board is fetched by project id, which
      // only this response supplies.
      expect(requestedPaths()[0]).toBe(`/api/tasks/${T1}`);
      expect(requestedPaths()).toContain(`/api/projects/${PROJECT_ID}`);
      expect(board.currentProjectId).toBe(PROJECT_ID);
    } finally {
      void unmount(app);
    }
  });

  it('renders NotFound without asking for a board when the task 404s', async () => {
    mockApi([]);
    router.navigate(taskHref(T1, 'gone'), { replace: true });

    const app = mountOnRoute();
    try {
      expect(await screen.findByText(/not found/i)).toBeInTheDocument();
      expect(requestedPaths()).toEqual([`/api/tasks/${T1}`]);
    } finally {
      void unmount(app);
    }
  });

  it('offers a retry on a server error rather than calling the card missing', async () => {
    let attempts = 0;
    mockApi([task(T1, 'Boss fight')], (id) => {
      attempts += 1;
      return attempts === 1
        ? jsonResponse(500, { error: 'boom' })
        : jsonResponse(200, { ...task(id, 'Boss fight'), project_id: PROJECT_ID, images: [] });
    });
    router.navigate(taskHref(T1, 'boom'), { replace: true });

    const app = mountOnRoute();
    try {
      const again = await screen.findByRole('button', { name: 'Try again' });
      expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();

      await fireEvent.click(again);

      expect(await screen.findByLabelText('Task title')).toHaveValue('Boss fight');
      expect(board.currentProjectId).toBe(PROJECT_ID);
    } finally {
      void unmount(app);
    }
  });

  // Resolving a task reads several stores, any of which can churn on its own while
  // the failure is on screen. Only the retry button may ask again.
  it('does not ask again when an unrelated store changes under the error', async () => {
    let attempts = 0;
    mockApi([task(T1, 'Boss fight')], () => {
      attempts += 1;
      return jsonResponse(500, { error: 'boom' });
    });
    router.navigate(taskHref(T1, 'boom'), { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByRole('button', { name: 'Try again' });
      expect(attempts).toBe(1);

      search.results = [
        {
          task_id: T2,
          title: 'Credits',
          project_id: PROJECT_ID,
          project_name: PROJECT_NAME,
          column_name: 'To Do',
        },
      ];
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(attempts).toBe(1);
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    } finally {
      void unmount(app);
    }
  });

  it('tries again on the next arrival, which a reload is no longer needed for', async () => {
    let attempts = 0;
    mockApi([task(T1, 'Boss fight')], (id) => {
      attempts += 1;
      return attempts === 1
        ? jsonResponse(500, { error: 'boom' })
        : jsonResponse(200, { ...task(id, 'Boss fight'), project_id: PROJECT_ID, images: [] });
    });
    router.navigate(taskHref(T1, 'boom'), { replace: true });

    const first = mountOnRoute();
    try {
      await screen.findByRole('button', { name: 'Try again' });
    } finally {
      await unmount(first);
    }

    const second = mountOnRoute();
    try {
      expect(await screen.findByLabelText('Task title')).toHaveValue('Boss fight');
    } finally {
      void unmount(second);
    }
  });

  it('lands on the right board with an empty overlay for an archived card', async () => {
    mockApi([task(T1, 'Boss fight')], (id) =>
      id === ARCHIVED_ID
        ? jsonResponse(200, {
            ...task(ARCHIVED_ID, 'Shelved work'),
            project_id: PROJECT_ID,
            archived_at: '2026-07-20T00:00:00Z',
            images: [],
          })
        : jsonResponse(404, { error: 'Task not found' })
    );
    const path = `/t/${encodeId(ARCHIVED_ID)}`;
    router.navigate(path, { replace: true });

    const app = mountOnRoute();
    try {
      await waitFor(() => {
        expect(board.currentProjectId).toBe(PROJECT_ID);
      });
      await screen.findByRole('heading', { name: PROJECT_NAME });
      // The board payload excludes archived rows, so there is no title to slug and
      // the URL is deliberately left as it arrived.
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(router.path).toBe(path);
    } finally {
      void unmount(app);
    }
  });

  it('rejects a non-canonical alias before any request', async () => {
    mockApi([task(T1, 'Boss fight')]);
    const alias = encodeId(T1);
    router.navigate(`/t/${alias.slice(0, 21)}B`, { replace: true });

    const app = mountOnRoute();
    try {
      expect(await screen.findByText(/not found/i)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      void unmount(app);
    }
  });
});

describe('in-app navigation', () => {
  // A remount would re-run the board load into its revalidation, reset the
  // selection and the announcer, lose the board's scroll position and destroy an
  // in-flight title edit in the overlay. Node identity is what proves it did not
  // happen: a remount replaces every element.
  it('opens a card without remounting the board', async () => {
    mockApi([task(T1, 'Boss fight'), task(T2, 'Credits', 2000)]);
    router.navigate(projectHref(PROJECT_ID, PROJECT_NAME), { replace: true });

    const app = mountOnRoute();
    try {
      const heading = await screen.findByRole('heading', { name: PROJECT_NAME });
      await new Promise((resolve) => setTimeout(resolve, 25));

      await fireEvent.click(screen.getAllByRole('link', { name: 'Boss fight' })[0]!);

      expect(await screen.findByLabelText('Task title')).toHaveValue('Boss fight');
      expect(screen.getByRole('heading', { name: PROJECT_NAME })).toBe(heading);
      // A route-level spinner is the other tell: it only renders while the target
      // is unresolved, which an in-app click never is.
      expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument();
    } finally {
      void unmount(app);
    }
  });

  it('resolves a card the board already holds without a lookup of its own', async () => {
    mockApi([task(T1, 'Boss fight')]);
    router.navigate(projectHref(PROJECT_ID, PROJECT_NAME), { replace: true });

    const app = mountOnRoute();
    try {
      await screen.findByRole('heading', { name: PROJECT_NAME });
      expect(taskRoute.locate({ projectId: null, taskId: T1 })).toEqual({
        status: 'ready',
        projectId: PROJECT_ID,
      });
      fetchMock.mockClear();

      router.navigate(taskHref(T1, 'Boss fight'));
      await screen.findByLabelText('Task title');

      // Exactly one: the overlay's own detail load. The resolver adds none,
      // because the board already answered the question.
      expect(requestedPaths().filter((p) => p === `/api/tasks/${T1}`)).toHaveLength(1);
    } finally {
      void unmount(app);
    }
  });
});
