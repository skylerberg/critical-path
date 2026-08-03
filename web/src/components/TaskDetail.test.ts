import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Editor } from '@tiptap/core';
import TaskDetail from './TaskDetail.svelte';
import { board } from '../lib/board.svelte';
import { drafts } from '../lib/drafts.svelte';
import { projects } from '../lib/projects.svelte';
import { router } from '../lib/router.svelte';
import { session } from '../lib/session.svelte';
import {
  projectHref,
  publicBoardHref,
  publicTaskHref,
  taskHref,
  type ProjectView,
} from '../lib/short-links';
import { shortcuts } from '../lib/shortcuts.svelte';
import { taskActivity } from '../lib/taskActivity.svelte';
import { testUuid } from '../lib/test-ids';
import { TASK_TITLE_MAX_LENGTH, truncateTitle } from '../lib/titles';
import { users } from '../lib/users.svelte';
import type { BoardTask } from '../lib/board-types';

const PROJECT_ID = testUuid('p1');
const PROJECT_NAME = 'Game';
const T1 = testUuid('t1');
const T2 = testUuid('t2');
const T3 = testUuid('t3');
const T4 = testUuid('t4');
const T5 = testUuid('t5');
const T6 = testUuid('t6');
const T9 = testUuid('t9');
const MISSING = testUuid('missing');
const BOARD_PATH = projectHref(PROJECT_ID, PROJECT_NAME);
const GRAPH_PATH = projectHref(PROJECT_ID, PROJECT_NAME, 'graph');

function overlayTaskPath(id: string, view: ProjectView = 'board'): string {
  return taskHref(id, board.tasks.find((t) => t.id === id)?.title ?? '', view);
}

const publicView = {
  closePath: publicBoardHref(PROJECT_ID),
  taskPath: (id: string) => publicTaskHref(PROJECT_ID, id),
  readonly: true,
};

function task(
  id: string,
  columnId: string,
  title: string,
  overrides?: Partial<BoardTask>
): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    position: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    ...overrides,
  };
}

const image = {
  id: 'img1',
  url: '/api/images/img1',
  filename: 'mock.png',
  content_type: 'image/png',
  size_bytes: 123,
  created_at: '2026-01-01T00:00:00Z',
};

const comment = {
  id: 'cm1',
  task_id: T1,
  user_id: 'u1',
  body: {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first thoughts' }] }],
  },
  created_at: '2026-01-03T00:00:00Z',
  updated_at: '2026-01-03T00:00:00Z',
};

const me = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  avatar_url: null,
  email_verified: false,
};

const activityEntry = {
  id: 'ac1',
  kind: 'created' as const,
  actor_user_id: 'u1',
  old_value: null,
  new_value: { text: 'Design cards' },
  created_at: '2026-01-01T00:00:00.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  board.taskImages = {};
  board.taskComments = {};
  taskActivity.reset();
  shortcuts.reset();
  drafts.clearAll();
  projects.reset();
  users.reset();
  session.user = me;
  board.currentProjectId = PROJECT_ID;
  board.project = {
    id: PROJECT_ID,
    name: PROJECT_NAME,
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
    { id: 'c1', name: 'Todo', position: 1000, is_done: false },
    { id: 'c2', name: 'Done', position: 2000, is_done: true },
  ];
  board.tasks = [
    task(T1, 'c1', 'Design cards', {
      label_ids: ['l1'],
      assignee_ids: ['u1'],
      blocker_ids: [T2, T3],
      image_count: 1,
    }),
    task(T2, 'c1', 'Cut prototype'),
    task(T3, 'c2', 'Buy sleeves', { position: 5000 }),
    task(T4, 'c1', 'Playtest session', { blocker_ids: [T1] }),
  ];
  board.labels = [
    { id: 'l1', name: 'art', color: '#ff0000' },
    { id: 'l2', name: 'rules', color: '#00ff00' },
  ];
  users.users = [{ id: 'u1', name: 'Ada Lovelace', avatar_url: null }];
  mockRoutes();
});

const SERVER_UPDATED_AT = '2026-03-01T00:00:00Z';

function mockRoutes(
  override?: (request: Request, url: URL) => Response | Promise<Response> | undefined
): void {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const url = new URL(request.url);
    const response = override?.(request, url);
    if (response !== undefined) {
      return response;
    }
    if (request.method === 'GET' && url.pathname === `/api/tasks/${T1}`) {
      return jsonResponse(200, {
        ...board.tasks[0],
        project_id: PROJECT_ID,
        images: [image],
        comments: [comment],
      });
    }
    if (request.method === 'GET' && url.pathname.endsWith('/activity')) {
      return jsonResponse(200, {
        activity: url.pathname === `/api/tasks/${T1}/activity` ? [activityEntry] : [],
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/users') {
      return jsonResponse(200, { users: users.users });
    }
    if (request.method === 'GET' && url.pathname === `/api/projects/${PROJECT_ID}`) {
      return jsonResponse(200, {
        project: board.project,
        columns: board.columns,
        tasks: board.tasks,
        labels: board.labels,
      });
    }
    if (request.method === 'PATCH' && url.pathname === `/api/tasks/${T1}`) {
      const existing = board.tasks.find((t) => t.id === T1) ?? task(T1, 'c1', 'Design cards');
      return jsonResponse(200, { ...existing, updated_at: SERVER_UPDATED_AT });
    }
    return jsonResponse(204);
  });
}

function activityRequests(taskId: string): Request[] {
  return fetchMock.mock.calls
    .map((call) => call[0] as Request)
    .filter((request) => new URL(request.url).pathname === `/api/tasks/${taskId}/activity`);
}

function taskPatches(): Request[] {
  return fetchMock.mock.calls
    .map((call) => call[0] as Request)
    .filter(
      (request) =>
        request.method === 'PATCH' && new URL(request.url).pathname === `/api/tasks/${T1}`
    );
}

function teammateVersion(): BoardTask {
  return task(T1, 'c1', 'Their title', {
    label_ids: ['l1'],
    assignee_ids: ['u1'],
    blocker_ids: [T2, T3],
    image_count: 1,
    updated_at: '2026-05-05T00:00:00Z',
    description: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Their description' }] }],
    },
  });
}

function mockConflict(
  patchResponse: () => Response | Promise<Response> = () =>
    jsonResponse(409, { error: 'This task changed since you loaded it' })
): void {
  mockRoutes((request, url) => {
    if (request.method === 'PATCH' && url.pathname === `/api/tasks/${T1}`) {
      return patchResponse();
    }
    if (request.method === 'GET' && url.pathname === `/api/projects/${PROJECT_ID}`) {
      return jsonResponse(200, {
        project: board.project,
        columns: board.columns,
        tasks: [teammateVersion(), ...board.tasks.filter((t) => t.id !== T1)],
        labels: board.labels,
      });
    }
    return undefined;
  });
}

async function editTitle(value: string): Promise<void> {
  const input = screen.getByLabelText('Task title');
  await fireEvent.input(input, { target: { value } });
  await fireEvent.blur(input);
}

function renderDetail(props: {
  taskId: string;
  closePath: string;
  taskPath?: (id: string) => string;
  readonly?: boolean;
}): ReturnType<typeof render> {
  return render(TaskDetail, {
    taskPath: (id: string) => overlayTaskPath(id),
    ...props,
  });
}

// Tiptap hangs the editor off its own DOM node; nothing else exposes the instance.
function descriptionEditor(container: HTMLElement): Editor {
  const dom = container.querySelector('.tiptap') as (HTMLElement & { editor?: Editor }) | null;
  if (!dom?.editor) {
    throw new Error('description editor not mounted');
  }
  return dom.editor;
}

describe('TaskDetail', () => {
  it('renders title, labels, assignees, blocked-by, timestamps, and fetched images', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    expect(screen.getByLabelText('Task title')).toHaveValue('Design cards');
    expect(screen.getByLabelText('Task title')).toHaveAttribute('autocapitalize', 'sentences');

    expect(screen.getByRole('button', { name: 'Remove label art' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove label rules' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Ada Lovelace/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    expect(screen.getByText('Cut prototype')).toBeInTheDocument();
    expect(screen.getByText('Buy sleeves')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Blocked by' })).toBeInTheDocument();
    expect(screen.getByText('1 open task')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove blocking task Cut prototype' })
    ).toBeInTheDocument();

    expect(await screen.findByAltText('mock.png')).toHaveAttribute('src', '/api/images/img1');
    expect(screen.getByRole('button', { name: 'Delete image mock.png' })).toBeInTheDocument();

    expect(screen.getByText(/Created .+ · Updated .+/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('loads images and comments from the one detail fetch and renders the Activity section', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    await waitFor(() => expect(board.taskComments[T1]).toEqual([comment]));
    expect(board.taskImages[T1]).toEqual([image]);
    expect(await screen.findByText('first thoughts')).toBeInTheDocument();
  });

  // The overlay is the surface a long title is opened to read, so it is the one
  // place clipping would be a defect rather than the rule.
  describe('long titles', () => {
    const long = 'L'.repeat(TASK_TITLE_MAX_LENGTH);

    beforeEach(() => {
      board.tasks = [
        task(T1, 'c1', long, { blocker_ids: [T2] }),
        task(T2, 'c1', long.replace(/^L/, 'B')),
      ];
    });

    it('renders the whole stored title in the editor and caps its length at the stored bound', () => {
      renderDetail({ taskId: T1, closePath: BOARD_PATH });

      const input = screen.getByLabelText('Task title');
      expect(input).toHaveValue(long);
      expect(input).toHaveAttribute('maxlength', String(TASK_TITLE_MAX_LENGTH));
    });

    it('renders the whole stored title as text on a read-only board', () => {
      renderDetail({ taskId: T1, ...publicView });

      expect(screen.getByRole('heading', { name: long })).toBeInTheDocument();
    });

    it('clips the blockers it merely references, and its own dialog name', () => {
      renderDetail({ taskId: T1, closePath: BOARD_PATH });

      const blocker = board.tasks[1].title;
      expect(screen.getByText(truncateTitle(blocker))).toBeInTheDocument();
      expect(screen.queryByText(blocker)).toBeNull();
      expect(
        screen.getByRole('button', { name: `Remove blocking task ${truncateTitle(blocker)}` })
      ).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toHaveAccessibleName(truncateTitle(long));
    });
  });

  describe('cover image', () => {
    function coverToggle(): HTMLElement {
      return screen.getByRole('button', { name: 'Use image mock.png as cover' });
    }

    function coverRequests(): Request[] {
      return fetchMock.mock.calls
        .map((call) => call[0] as Request)
        .filter((request) => new URL(request.url).pathname === `/api/tasks/${T1}/cover`);
    }

    function coverOfT1(): string | null | undefined {
      return board.tasks.find((t) => t.id === T1)?.cover_image_url;
    }

    it('marks an image as the cover and shows it as pressed', async () => {
      renderDetail({ taskId: T1, closePath: BOARD_PATH });
      await screen.findByAltText('mock.png');
      expect(coverToggle()).toHaveAttribute('aria-pressed', 'false');

      await fireEvent.click(coverToggle());

      expect(coverRequests()).toHaveLength(1);
      expect(coverRequests()[0]!.method).toBe('PUT');
      expect(await coverRequests()[0]!.json()).toEqual({ image_id: 'img1' });
      expect(coverOfT1()).toBe('/api/images/img1');
      await waitFor(() => expect(coverToggle()).toHaveAttribute('aria-pressed', 'true'));
    });

    it('clears the cover when the current one is toggled off', async () => {
      board.tasks = board.tasks.map((t) =>
        t.id === T1 ? { ...t, cover_image_url: '/api/images/img1' } : t
      );
      renderDetail({ taskId: T1, closePath: BOARD_PATH });
      await screen.findByAltText('mock.png');
      expect(coverToggle()).toHaveAttribute('aria-pressed', 'true');

      await fireEvent.click(coverToggle());

      expect(await coverRequests()[0]!.json()).toEqual({ image_id: null });
      expect(coverOfT1()).toBeNull();
    });

    it('clears the card cover when the cover image is deleted', async () => {
      board.tasks = board.tasks.map((t) =>
        t.id === T1 ? { ...t, cover_image_url: '/api/images/img1' } : t
      );
      renderDetail({ taskId: T1, closePath: BOARD_PATH });
      await screen.findByAltText('mock.png');

      await fireEvent.click(screen.getByRole('button', { name: 'Delete image mock.png' }));

      expect(coverOfT1()).toBeNull();
    });

    it('offers no cover toggle on a read-only board', async () => {
      renderDetail({ taskId: T1, ...publicView });

      await waitFor(() => expect(screen.getByRole('heading', { name: 'Column' })).toBeVisible());
      expect(screen.queryByRole('button', { name: /as cover/ })).toBeNull();
    });
  });

  it('loads the activity log and interleaves it with the comments', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await waitFor(() => expect(taskActivity.entries).toEqual([activityEntry]));
    expect(await screen.findByText(/created this task/)).toBeInTheDocument();
    const stream = screen.getAllByRole('listitem').filter((item) => item.textContent !== null);
    const created = stream.findIndex((item) => item.textContent!.includes('created this task'));
    const written = stream.findIndex((item) => item.textContent!.includes('first thoughts'));
    expect(created).toBeGreaterThanOrEqual(0);
    expect(created).toBeLessThan(written);
  });

  it('drops the previous task’s log when the overlay switches task', async () => {
    const { rerender } = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await waitFor(() => expect(taskActivity.entries).toEqual([activityEntry]));

    await rerender({ taskId: T2, closePath: BOARD_PATH });
    await waitFor(() => expect(taskActivity.entries).toEqual([]));
    expect(
      fetchMock.mock.calls.some(
        (call) => new URL((call[0] as Request).url).pathname === `/api/tasks/${T2}/activity`
      )
    ).toBe(true);
  });

  it('drops the log on unmount and stops refetching it for the closed overlay', async () => {
    const { unmount } = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await waitFor(() => expect(taskActivity.entries).toEqual([activityEntry]));

    unmount();
    await tick();
    expect(taskActivity.entries).toEqual([]);

    const sent = activityRequests(T1).length;
    vi.useFakeTimers();
    try {
      taskActivity.invalidate(T1);
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
    expect(activityRequests(T1)).toHaveLength(sent);
  });

  it('renders the column select with the current column and all columns as options', () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    const select = screen.getByLabelText('Column');
    expect(select).toHaveValue('c1');
    expect(screen.getByRole('option', { name: 'Todo' })).toHaveValue('c1');
    expect(screen.getByRole('option', { name: 'Done' })).toHaveValue('c2');
  });

  it('moves the task to the bottom of the selected column', async () => {
    const spy = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'c2' } });

    expect(spy).toHaveBeenCalledWith(T1, 'c2', 6000);
  });

  it('requests the move menu for this task from the Move… button', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await fireEvent.click(screen.getByRole('button', { name: 'Move…' }));

    expect(shortcuts.moveMenu).toBe(T1);
  });

  it('does not move the task when the current column is re-selected', async () => {
    const spy = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'c1' } });

    expect(spy).not.toHaveBeenCalled();
  });

  it('shows a fallback when the task is not in the store', () => {
    renderDetail({ taskId: MISSING, closePath: BOARD_PATH });

    expect(screen.getByText('Task not found')).toBeInTheDocument();
  });

  it('offers no delete: an open card can only be archived, and delete lives in the archive', () => {
    const deleteSpy = vi.spyOn(board, 'deleteTask').mockResolvedValue();

    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    expect(screen.queryByRole('button', { name: /Delete task/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Confirm delete/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('archives without a confirm step, then redirects once the card is off the board', async () => {
    const redirectSpy = vi.spyOn(router, 'redirect').mockImplementation(() => {});
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === `/api/tasks/${T1}/archive`
        ? jsonResponse(200, {
            ...task(T1, 'c1', 'Design cards'),
            archived_at: '2026-03-01T12:00:00Z',
          })
        : undefined
    );

    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(redirectSpy).toHaveBeenCalledWith(BOARD_PATH));
    expect(board.tasks.some((t) => t.id === T1)).toBe(false);
    expect(board.archivedTasks.map((t) => t.id)).toEqual([T1]);
    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).toContain(`/api/tasks/${T1}/archive`);
  });

  // closePath carries a query string, and is a different route entirely for a card
  // opened from My Tasks, so no task URL can be built by appending to it.
  it('opens the copy at the path it was handed, whatever closePath is', async () => {
    const duplicate = vi.spyOn(board, 'duplicateTask').mockResolvedValue(T9);
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});

    const first = renderDetail({
      taskId: T1,
      closePath: '/my-tasks',
      taskPath: (id) => overlayTaskPath(id) + '?from=my-tasks',
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(taskHref(T9, '') + '?from=my-tasks'));
    expect(duplicate).toHaveBeenCalledWith(T1);
    first.unmount();

    renderDetail({
      taskId: T1,
      closePath: GRAPH_PATH + '?labels=l1',
      taskPath: (id) => overlayTaskPath(id, 'graph') + '?labels=l1',
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(taskHref(T9, '', 'graph') + '?labels=l1')
    );
  });

  it('stays on the original card when the duplicate fails', async () => {
    vi.spyOn(board, 'duplicateTask').mockResolvedValue(null);
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});

    renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

    await tick();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('disables Duplicate while the copy is in flight', async () => {
    let finish!: (id: string | null) => void;
    vi.spyOn(board, 'duplicateTask').mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        })
    );
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});

    renderDetail({ taskId: T1, closePath: BOARD_PATH });
    const button = screen.getByRole('button', { name: 'Duplicate' });
    await fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());

    finish(T9);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(taskHref(T9, '')));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(button).not.toBeDisabled();
  });

  it('does not open the copy when the overlay was closed while it was in flight', async () => {
    let finish!: (id: string | null) => void;
    vi.spyOn(board, 'duplicateTask').mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        })
    );
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    const redirect = vi.spyOn(router, 'redirect').mockImplementation(() => {});

    renderDetail({ taskId: T1, closePath: BOARD_PATH });
    const button = screen.getByRole('button', { name: 'Duplicate' });
    await fireEvent.click(button);
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    finish(T9);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(redirect).toHaveBeenCalledWith(BOARD_PATH);
    expect(navigate).not.toHaveBeenCalled();
  });

  // Back, a sidebar link and the auth redirect all dismiss the overlay without
  // running close(), which is the only thing the test above exercises.
  it('does not open the copy when the overlay unmounted while it was in flight', async () => {
    let finish!: (id: string | null) => void;
    vi.spyOn(board, 'duplicateTask').mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        })
    );
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});

    const view = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    view.unmount();

    finish(T9);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not open the copy when the overlay moved to another card in flight', async () => {
    let finish!: (id: string | null) => void;
    vi.spyOn(board, 'duplicateTask').mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        })
    );
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});

    const view = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await view.rerender({ taskId: T2, closePath: BOARD_PATH });

    finish(T9);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigate).not.toHaveBeenCalled();
  });

  // The server copies whatever the row holds when it reads it, so the PATCH the blur
  // fired has to land before the copy is taken.
  it('holds the duplicate until the queued title save has landed', async () => {
    let releasePatch!: () => void;
    mockRoutes((request, url) =>
      request.method === 'PATCH' && url.pathname === `/api/tasks/${T1}`
        ? new Promise<Response>((resolve) => {
            releasePatch = () =>
              resolve(jsonResponse(200, { ...board.tasks[0], updated_at: SERVER_UPDATED_AT }));
          })
        : undefined
    );
    const duplicate = vi.spyOn(board, 'duplicateTask').mockResolvedValue(T9);
    vi.spyOn(router, 'navigate').mockImplementation(() => {});

    renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await editTitle('Renamed');
    await fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

    await tick();
    expect(duplicate).not.toHaveBeenCalled();

    releasePatch();
    await waitFor(() => expect(duplicate).toHaveBeenCalledWith(T1));
  });

  it('waits for the archive to finish before redirecting', async () => {
    let resolveArchive: (() => void) | undefined;
    const archiveSpy = vi.spyOn(board, 'archiveTask').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveArchive = resolve;
        })
    );
    const redirectSpy = vi.spyOn(router, 'redirect').mockImplementation(() => {});

    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(archiveSpy).toHaveBeenCalledWith(T1);
    expect(redirectSpy).not.toHaveBeenCalled();

    resolveArchive?.();
    await waitFor(() => expect(redirectSpy).toHaveBeenCalledWith(BOARD_PATH));
  });

  it('discards an uncommitted title edit when the overlay closes', async () => {
    const update = vi.spyOn(board, 'updateTask').mockResolvedValue({
      status: 'ok',
      updated_at: SERVER_UPDATED_AT,
    });
    const first = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await fireEvent.input(screen.getByLabelText('Task title'), {
      target: { value: 'Design cards v2' },
    });
    first.unmount();
    expect(update).not.toHaveBeenCalled();

    renderDetail({ taskId: T1, closePath: BOARD_PATH });
    const reopened = screen.getByLabelText('Task title');
    expect(reopened).toHaveValue('Design cards');

    await fireEvent.blur(reopened);

    expect(update).not.toHaveBeenCalled();
  });

  it('discards the title draft on Escape', async () => {
    const update = vi.spyOn(board, 'updateTask').mockResolvedValue({
      status: 'ok',
      updated_at: SERVER_UPDATED_AT,
    });
    vi.spyOn(router, 'redirect').mockImplementation(() => {});
    const first = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await fireEvent.input(screen.getByLabelText('Task title'), { target: { value: 'Scrapped' } });

    await fireEvent(document.querySelector('dialog')!, new Event('cancel', { cancelable: true }));

    first.unmount();

    renderDetail({ taskId: T1, closePath: BOARD_PATH });
    expect(screen.getByLabelText('Task title')).toHaveValue('Design cards');
    expect(update).not.toHaveBeenCalled();
  });

  it('does not carry a title edit onto another task', async () => {
    const first = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await fireEvent.input(screen.getByLabelText('Task title'), { target: { value: 'Only t1' } });
    first.unmount();

    renderDetail({ taskId: T2, closePath: BOARD_PATH });

    expect(screen.getByLabelText('Task title')).toHaveValue('Cut prototype');
  });

  it('sends the loaded updated_at as the precondition when committing a title', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');

    await waitFor(() => expect(taskPatches()).toHaveLength(1));
    expect(await taskPatches()[0]!.json()).toEqual({
      title: 'Design cards v2',
      expected_updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('advances the precondition to the response updated_at after a successful save', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');
    await waitFor(() => expect(taskPatches()).toHaveLength(1));
    await editTitle('Design cards v3');
    await waitFor(() => expect(taskPatches()).toHaveLength(2));

    expect(await taskPatches()[1]!.json()).toEqual({
      title: 'Design cards v3',
      expected_updated_at: SERVER_UPDATED_AT,
    });
  });

  it('holds a second save behind the first so it carries the fresh precondition', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let patches = 0;
    mockRoutes((request, url) => {
      if (request.method === 'PATCH' && url.pathname === `/api/tasks/${T1}`) {
        patches += 1;
        const saved = (): Response =>
          jsonResponse(200, { ...board.tasks[0], updated_at: SERVER_UPDATED_AT });
        return patches === 1 ? held.then(saved) : saved();
      }
      return undefined;
    });
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');
    await editTitle('Design cards v3');
    await editTitle('Design cards v3');
    expect(taskPatches()).toHaveLength(1);

    release?.();
    await waitFor(() => expect(taskPatches()).toHaveLength(2));
    expect(await taskPatches()[1]!.json()).toEqual({
      title: 'Design cards v3',
      expected_updated_at: SERVER_UPDATED_AT,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskPatches()).toHaveLength(2);
  });

  it('still saves a title reverted while an earlier save is in flight', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let patches = 0;
    mockRoutes((request, url) => {
      if (request.method === 'PATCH' && url.pathname === `/api/tasks/${T1}`) {
        patches += 1;
        const saved = (): Response =>
          jsonResponse(200, { ...board.tasks[0], updated_at: SERVER_UPDATED_AT });
        return patches === 1 ? held.then(saved) : saved();
      }
      return undefined;
    });
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');
    await editTitle('Design cards');
    release?.();

    await waitFor(() => expect(taskPatches()).toHaveLength(2));
    expect(await taskPatches()[1]!.json()).toEqual({
      title: 'Design cards',
      expected_updated_at: SERVER_UPDATED_AT,
    });
    expect(screen.getByLabelText('Task title')).toHaveValue('Design cards');
  });

  it('keeps the typed title when the input is blurred again mid-save', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockConflict(() =>
      held.then(() => jsonResponse(409, { error: 'This task changed since you loaded it' }))
    );
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');
    await fireEvent.blur(screen.getByLabelText('Task title'));
    release?.();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Task title')).toHaveValue('Design cards v2');
    expect(taskPatches()).toHaveLength(1);
  });

  it('does not adopt a new precondition from a column change', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'c2' } });
    await waitFor(() => expect(taskPatches()).toHaveLength(1));
    await editTitle('Design cards v2');
    await waitFor(() => expect(taskPatches()).toHaveLength(2));

    expect(await taskPatches()[1]!.json()).toEqual({
      title: 'Design cards v2',
      expected_updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('keeps the typed title and shows the conflict banner when the save is stale', async () => {
    mockConflict();
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed somewhere else/);
    expect(screen.getByLabelText('Task title')).toHaveValue('Design cards v2');
  });

  it('sends nothing further while conflicted', async () => {
    mockConflict();
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');
    await screen.findByRole('alert');
    const sent = taskPatches().length;

    await editTitle('Design cards v3');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(taskPatches()).toHaveLength(sent);
  });

  it('reloads the server title and description and clears the banner', async () => {
    mockConflict();
    const { container } = renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');
    await screen.findByRole('alert');
    expect(container.querySelector('.tiptap')?.textContent).not.toContain('Their description');
    const sent = taskPatches().length;

    await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Task title')).toHaveValue('Their title');
    expect(container.querySelector('.tiptap')?.textContent).toContain('Their description');
    expect(taskPatches()).toHaveLength(sent);

    mockRoutes();
    await editTitle('Their title v2');

    await waitFor(() => expect(taskPatches()).toHaveLength(sent + 1));
    expect(await taskPatches()[sent]!.json()).toEqual({
      title: 'Their title v2',
      expected_updated_at: '2026-05-05T00:00:00Z',
    });
  });

  it('offers the project’s people in the description editor and saves the mention', async () => {
    projects.projects = [
      {
        id: PROJECT_ID,
        name: PROJECT_NAME,
        description: '',
        created_by: 'u1',
        member_ids: ['u2'],
        members: [{ user_id: 'u2', role: 'editor' as const }],
        is_public: false,
        color: null,
        archived_at: null,
        created_at: '2026-01-01T00:00:00Z',
        open_task_count: 0,
        done_task_count: 0,
        position: null,
        last_seen_at: null,
        has_unseen_changes: false,
      },
    ];
    users.setForProject(PROJECT_ID, [
      ...users.users,
      { id: 'u2', name: 'Bob Barker', avatar_url: null },
      { id: 'u3', name: 'Stale Assignee', avatar_url: null },
    ]);
    const { container } = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await tick();

    descriptionEditor(container).commands.insertContent('@');
    const menu = await screen.findByRole('listbox', { name: 'Mention a person' });
    await waitFor(() =>
      expect(
        within(menu)
          .getAllByRole('option')
          .map((option) => option.textContent)
      ).toEqual([expect.stringContaining('Ada Lovelace'), expect.stringContaining('Bob Barker')])
    );

    await fireEvent.click(within(menu).getAllByRole('option')[1]);
    // Flush rather than wait out the 800 ms autosave, which leaves waitFor almost
    // no headroom on a loaded machine.
    await fireEvent.blur(descriptionEditor(container).view.dom);
    await waitFor(() => expect(taskPatches()).toHaveLength(1));
    const body = (await taskPatches()[0]!.json()) as { description: unknown };
    expect(JSON.stringify(body.description)).toContain('"id":"u2"');
  });

  it('sends the loaded updated_at as the precondition when saving the description', async () => {
    vi.useFakeTimers();
    try {
      const { container } = renderDetail({ taskId: T1, closePath: BOARD_PATH });
      await tick();

      descriptionEditor(container).commands.insertContent('Draft text');
      await vi.advanceTimersByTimeAsync(800);

      expect(taskPatches()).toHaveLength(1);
      const body = (await taskPatches()[0]!.json()) as {
        description: unknown;
        expected_updated_at: string;
      };
      expect(body.expected_updated_at).toBe('2026-01-02T00:00:00Z');
      expect(JSON.stringify(body.description)).toContain('Draft text');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the typed description and stops saving it when the save is stale', async () => {
    mockConflict();
    vi.useFakeTimers();
    try {
      const { container } = renderDetail({ taskId: T1, closePath: BOARD_PATH });
      await tick();
      const editor = descriptionEditor(container);

      editor.commands.insertContent('Draft text');
      await vi.advanceTimersByTimeAsync(800);
      await tick();

      expect(screen.getByRole('alert')).toHaveTextContent(/changed somewhere else/);
      expect(container.querySelector('.tiptap')?.textContent).toContain('Draft text');
      const sent = taskPatches().length;

      editor.commands.insertContent(' and more');
      await vi.advanceTimersByTimeAsync(800);

      expect(taskPatches()).toHaveLength(sent);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not adopt a teammate’s realtime update as its precondition', async () => {
    mockConflict();
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    board.applyRealtime({ type: 'task_updated', project_id: PROJECT_ID, data: teammateVersion() });
    await tick();
    await editTitle('Design cards v2');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await taskPatches()[0]!.json()).toEqual({
      title: 'Design cards v2',
      expected_updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('offers the due date behind an add affordance, like labels and assignees', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    expect(screen.getByRole('heading', { name: 'Due date' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Due date')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: '+ Add due date' }));
    await fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '2026-08-03' },
    });

    expect(await taskPatches()[0]!.json()).toEqual({ due_date: '2026-08-03' });
  });

  it('lists tasks that depend on this one and removes the reverse relation', async () => {
    const spy = vi.spyOn(board, 'removeBlocker').mockResolvedValue(undefined);
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    expect(screen.getByRole('heading', { name: 'Blocks' })).toBeInTheDocument();
    const remove = screen.getByRole('button', { name: 'Remove blocked task Playtest session' });
    await fireEvent.click(remove);

    expect(spy).toHaveBeenCalledWith(T4, T1);
  });
});

describe('TaskDetail on a public board', () => {
  beforeEach(() => {
    session.user = null;
    board.readonly = true;
    users.setForProject(PROJECT_ID, [{ id: 'u1', name: 'Ada Lovelace', avatar_url: null }]);
  });

  it('renders the card as text with no editing surface and no authenticated fetches', async () => {
    renderDetail({ taskId: T1, ...publicView });

    expect(screen.queryByLabelText('Task title')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Design cards' })).toBeInTheDocument();

    expect(screen.queryByLabelText('Column')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Column' })).toBeInTheDocument();
    expect(screen.getByText('Todo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move…' })).toBeNull();

    expect(screen.getByText('art')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove label art' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add label' })).toBeNull();

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ada Lovelace/ })).toBeNull();

    expect(screen.getByText('Cut prototype')).toBeInTheDocument();
    expect(screen.getByText('Playtest session')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove blocking task/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove blocked task/ })).toBeNull();
    expect(screen.queryByLabelText('Add a blocking task')).toBeNull();

    expect(screen.queryByRole('heading', { name: 'Images' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload image' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete task' })).toBeNull();
    expect(screen.queryByText(/Created .+ · Updated .+/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Activity' })).toBeNull();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Column' })).toBeVisible());
    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).not.toContain(`/api/tasks/${T1}`);
    expect(paths).not.toContain('/api/users');
  });

  it('renders the description read-only, with no formatting toolbar', async () => {
    board.tasks = board.tasks.map((t) =>
      t.id === T1
        ? {
            ...t,
            description: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship it' }] }],
            },
          }
        : t
    );

    renderDetail({ taskId: T1, ...publicView });

    expect(await screen.findByText('Ship it')).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull();
    expect(document.querySelector('.tiptap')).toHaveAttribute('contenteditable', 'false');
  });

  it('never writes, so it sends no precondition and never banners a conflict', async () => {
    vi.useFakeTimers();
    try {
      board.tasks = board.tasks.map((t) =>
        t.id === T1
          ? {
              ...t,
              description: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship it' }] }],
              },
            }
          : t
      );

      const { container } = renderDetail({ taskId: T1, ...publicView });
      await tick();

      descriptionEditor(container).commands.insertContent('Sneaky edit');
      await vi.advanceTimersByTimeAsync(800);

      expect(taskPatches()).toHaveLength(0);
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides sections a public card has nothing to show for', () => {
    board.tasks = [...board.tasks, task(T5, 'c1', 'Bare card')];

    renderDetail({ taskId: T5, ...publicView });

    expect(screen.getByRole('heading', { name: 'Bare card' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Description' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Labels' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Assignees' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Blocked by' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Blocks' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Due date' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Comments' })).toBeNull();
  });

  it('shows a published due date as plain text with nothing to edit', () => {
    board.tasks = [...board.tasks, task(T6, 'c1', 'Dated card', { due_date: '2026-08-03' })];

    renderDetail({ taskId: T6, ...publicView });

    expect(screen.getByRole('heading', { name: 'Due date' })).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Due date')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add due date' })).toBeNull();
  });

  it('shows the published comments and their authors, with nothing to write with', async () => {
    board.tasks = board.tasks.map((t) => (t.id === T1 ? { ...t, comment_count: 1 } : t));
    board.taskComments = { [T1]: [comment] };

    renderDetail({ taskId: T1, ...publicView });

    const heading = screen.getByRole('heading', { name: 'Comments' });
    expect(await screen.findByText('first thoughts')).toBeInTheDocument();
    expect(within(heading.closest('section')!).getByText('Ada Lovelace')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
    expect(screen.queryByPlaceholderText('Write a comment…')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit comment/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete comment/ })).toBeNull();
  });

  // A member reading their own project through the shared link is signed in, but
  // the board in the store came from the anonymous payload — writing against it
  // would mutate a copy no refetch can reconcile.
  it('offers no comment controls to a signed-in reader who came through the link', async () => {
    session.user = me;
    board.tasks = board.tasks.map((t) => (t.id === T1 ? { ...t, comment_count: 1 } : t));
    board.taskComments = { [T1]: [comment] };

    renderDetail({ taskId: T1, ...publicView });

    expect(await screen.findByText('first thoughts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit comment/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete comment/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
  });

  it('never shows the activity log alongside the published comments', async () => {
    taskActivity.entries = [activityEntry];
    board.tasks = board.tasks.map((t) => (t.id === T1 ? { ...t, comment_count: 1 } : t));
    board.taskComments = { [T1]: [comment] };

    renderDetail({ taskId: T1, ...publicView });

    expect(await screen.findByText('first thoughts')).toBeInTheDocument();
    expect(screen.queryByText('created this task')).toBeNull();
  });

  it('renders a mention in a published comment as a name', async () => {
    board.tasks = board.tasks.map((t) => (t.id === T1 ? { ...t, comment_count: 1 } : t));
    board.taskComments = {
      [T1]: [
        {
          ...comment,
          body: {
            type: 'doc' as const,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'mention', attrs: { id: 'u1', label: 'Stale Name' } }],
              },
            ],
          },
        },
      ],
    };

    renderDetail({ taskId: T1, ...publicView });

    expect(await screen.findByText('@Ada Lovelace')).toBeInTheDocument();
  });
});

describe('TaskDetail for a viewer', () => {
  beforeEach(() => {
    mockRoutes();
    users.setForProject(PROJECT_ID, [{ id: 'u1', name: 'Ada Lovelace', avatar_url: null }]);
  });

  it('drops every write control but keeps the comment stream and the history', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH, readonly: true });

    expect(screen.queryByLabelText('Task title')).toBeNull();
    expect(screen.queryByLabelText('Column')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload image' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete task' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add label' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove blocking task/ })).toBeNull();

    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(await screen.findByText('first thoughts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument();
    expect(screen.getByText(/Created .+ · Updated .+/)).toBeInTheDocument();
  });

  it('shows attached images without the cover or delete controls', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH, readonly: true });

    expect(await screen.findByAltText('mock.png')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /as cover$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete image/ })).toBeNull();
  });
});
