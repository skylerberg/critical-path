import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Editor } from '@tiptap/core';
import TaskDetail from './TaskDetail.svelte';
import TaskDetailRouteHost from './TaskDetailRouteHost.svelte';
import { board } from '../lib/board.svelte';
import { realtimeEvent } from '../lib/realtime-test-events';
import { conflictDrafts } from '../lib/conflictDrafts.svelte';
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
import { crossProjectDeps } from '../lib/crossProjectDeps.svelte';
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
    sort_key: 'V0000010001',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
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
    ...overrides,
  };
}

const image = {
  id: 'img1',
  task_id: T1,
  kind: 'image' as const,
  image_url: '/api/images/img1',
  is_cover: false,
  title: null,
  description: null,
  filename: 'mock.png',
  content_type: 'image/png',
  size_bytes: 123,
  url: null,
  preview_url: null,
  favicon_url: null,
  unfurl_state: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
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
  board.taskAttachments = {};
  board.taskComments = {};
  taskActivity.reset();
  crossProjectDeps.reset();
  crossProjectResponse = {
    blocked_by: [],
    blocking: [],
    hidden_blocked_by_count: 0,
    hidden_blocking_count: 0,
  };
  shortcuts.reset();
  drafts.clearAll();
  conflictDrafts.clearAll();
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
    { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
    { id: 'c2', name: 'Done', sort_key: 'V0000020001', is_done: true },
  ];
  board.tasks = [
    task(T1, 'c1', 'Design cards', {
      label_ids: ['l1'],
      assignee_ids: ['u1'],
      blocker_ids: [T2, T3],
      open_cross_project_blocker_count: 0,
    }),
    task(T2, 'c1', 'Cut prototype'),
    task(T3, 'c2', 'Buy sleeves', { sort_key: 'V0000050001' }),
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

let crossProjectResponse = {
  blocked_by: [] as unknown[],
  blocking: [] as unknown[],
  hidden_blocked_by_count: 0,
  hidden_blocking_count: 0,
};

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
        attachments: [image],
        comments: [comment],
      });
    }
    if (request.method === 'GET' && url.pathname.endsWith('/activity')) {
      return jsonResponse(200, {
        activity: url.pathname === `/api/tasks/${T1}/activity` ? [activityEntry] : [],
      });
    }
    if (request.method === 'GET' && url.pathname.endsWith('/cross-project-dependencies')) {
      return jsonResponse(200, crossProjectResponse);
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
    open_cross_project_blocker_count: 0,
    updated_at: '2026-05-05T00:00:00Z',
    description: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Their description' }] }],
    },
  });
}

// The API writes task.updated_at and the activity row's created_at from one
// transaction timestamp, which is what lets the overlay name who won.
const teammateEdit = {
  id: 'ac2',
  kind: 'title_changed' as const,
  actor_user_id: 'u2',
  old_value: { text: 'Design cards' },
  new_value: { text: 'Their title' },
  created_at: '2026-05-05T00:00:00Z',
};

function mockConflict(
  patchResponse: () => Response | Promise<Response> = () =>
    jsonResponse(409, { error: 'This task changed since you loaded it' }),
  activity: unknown[] = [activityEntry, teammateEdit]
): void {
  mockRoutes((request, url) => {
    if (request.method === 'PATCH' && url.pathname === `/api/tasks/${T1}`) {
      return patchResponse();
    }
    if (request.method === 'GET' && url.pathname === `/api/tasks/${T1}/activity`) {
      return jsonResponse(200, { activity });
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

async function openReview(): Promise<void> {
  await fireEvent.click(await screen.findByRole('button', { name: 'Review changes…' }));
  await screen.findByRole('heading', { name: 'Review conflicting changes' });
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

// History opens collapsed, and its header only exists once the card has rendered.
async function openHistory(): Promise<void> {
  await fireEvent.click(await screen.findByText('History'));
}

async function openQuickAction(name: string): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name }));
}

// Tiptap hangs the editor off its own DOM node; nothing else exposes the instance.
function descriptionEditor(container: HTMLElement, selector = '.tiptap'): Editor {
  const dom = container.querySelector(selector) as (HTMLElement & { editor?: Editor }) | null;
  if (!dom?.editor) {
    throw new Error(`editor not mounted for ${selector}`);
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
    expect(
      await screen.findByRole('button', { name: 'Unassign Ada Lovelace' })
    ).toBeInTheDocument();

    expect(screen.getByText('Cut prototype')).toBeInTheDocument();
    expect(screen.getByText('Buy sleeves')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Blocked by' })).toBeInTheDocument();
    expect(screen.getByText('1 open task')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove blocking task Cut prototype' })
    ).toBeInTheDocument();

    expect(await screen.findByAltText('mock.png')).toHaveAttribute('src', '/api/images/img1');
    expect(screen.getByRole('button', { name: 'Delete image mock.png' })).toBeInTheDocument();

    // The timestamps moved in with the rest of the audit trail.
    await openHistory();
    expect(await screen.findByText(/Created .+ · Updated .+/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('opens with focus on the dialog rather than the title field', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    const title = await screen.findByLabelText('Task title');
    expect(document.activeElement).toBe(title.closest('dialog'));
  });

  it('gathers images, files and links under one Attachments heading', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    expect(await screen.findByRole('heading', { name: 'Attachments' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Images' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Attach file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload image' })).toBeNull();

    const section = screen.getByRole('heading', { name: 'Attachments' }).closest('section');
    expect(section).toContainElement(await screen.findByAltText('mock.png'));
    expect(section).toContainElement(screen.getByRole('button', { name: 'Delete image mock.png' }));
  });

  it('loads images and comments from the one detail fetch and shows them without a click', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await waitFor(() => expect(board.taskComments[T1]).toEqual([comment]));
    expect(board.taskAttachments[T1]).toEqual([image]);
    expect(await screen.findByRole('heading', { name: /^Comments \(/ })).toBeInTheDocument();
    expect(await screen.findByText('first thoughts')).toBeInTheDocument();
  });

  describe('recurrence', () => {
    it('says a card repeats, in the same words the series panel uses', async () => {
      mockRoutes((request, url) =>
        request.method === 'GET' && url.pathname === `/api/tasks/${T1}`
          ? jsonResponse(200, {
              ...board.tasks[0],
              project_id: PROJECT_ID,
              series_summary: 'Every Monday',
              images: [],
              comments: [],
            })
          : undefined
      );
      renderDetail({ taskId: T1, closePath: BOARD_PATH });

      expect(await screen.findByText('Repeats: Every Monday')).toBeInTheDocument();
    });

    it('says nothing for a card that came from no series', async () => {
      renderDetail({ taskId: T1, closePath: BOARD_PATH });

      await waitFor(() => expect(board.taskAttachments[T1]).toEqual([image]));
      expect(screen.queryByText(/^Repeats:/)).not.toBeInTheDocument();
    });
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
      // The flag lives on the attachment row, which is what the server sends and
      // what the toggle reflects; the card's cover_image_url follows from it.
      mockRoutes((request, url) =>
        request.method === 'GET' && url.pathname === `/api/tasks/${T1}`
          ? jsonResponse(200, {
              ...board.tasks[0],
              project_id: PROJECT_ID,
              attachments: [{ ...image, is_cover: true }],
              comments: [],
            })
          : undefined
      );
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
      mockRoutes((request, url) =>
        request.method === 'GET' && url.pathname === `/api/tasks/${T1}`
          ? jsonResponse(200, {
              ...board.tasks[0],
              project_id: PROJECT_ID,
              attachments: [{ ...image, is_cover: true }],
              comments: [],
            })
          : undefined
      );
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

      await waitFor(() => expect(screen.getByText('Todo')).toBeVisible());
      expect(screen.queryByRole('button', { name: /as cover/ })).toBeNull();
    });
  });

  // History opens collapsed and nothing else reads the log, so fetching it on
  // every card open would be a request per card that nobody looks at.
  it('leaves the activity log unfetched until History is opened', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await screen.findByText('History');
    await waitFor(() => expect(board.taskComments[T1]).toEqual([comment]));

    expect(activityRequests(T1)).toHaveLength(0);

    await openHistory();
    await waitFor(() => expect(taskActivity.entries).toEqual([activityEntry]));
    expect(await screen.findByText(/created this task/)).toBeInTheDocument();
  });

  it('drops the previous task’s log when the overlay switches task', async () => {
    const { rerender } = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await openHistory();
    await waitFor(() => expect(taskActivity.entries).toEqual([activityEntry]));

    await rerender({ taskId: T2, closePath: BOARD_PATH });
    await openHistory();
    await waitFor(() => expect(taskActivity.entries).toEqual([]));
    expect(
      fetchMock.mock.calls.some(
        (call) => new URL((call[0] as Request).url).pathname === `/api/tasks/${T2}/activity`
      )
    ).toBe(true);
  });

  it('drops the log on unmount and stops refetching it for the closed overlay', async () => {
    const { unmount } = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await openHistory();
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

  // The bar button is the column display: there is no separate section for a
  // value every card always has.
  it('names the current column on the quick bar and lists the rest behind it', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await openQuickAction('Todo');
    const columns = screen.getByRole('group', { name: 'Move to column' });
    expect(within(columns).getByRole('button', { name: /Todo/ })).toHaveAttribute(
      'aria-current',
      'true'
    );
    expect(within(columns).getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('moves the task to the bottom of the column picked from the bar', async () => {
    const spy = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await openQuickAction('Todo');
    await fireEvent.click(
      within(screen.getByRole('group', { name: 'Move to column' })).getByRole('button', {
        name: 'Done',
      })
    );

    expect(spy).toHaveBeenCalledWith(T1, 'c2', {
      sort_key: expect.any(String),
    });
  });

  it('does not move the task when the current column is picked again', async () => {
    const spy = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await openQuickAction('Todo');
    await fireEvent.click(
      within(screen.getByRole('group', { name: 'Move to column' })).getByRole('button', {
        name: /Todo/,
      })
    );

    expect(spy).not.toHaveBeenCalled();
  });

  // Someone writing a comment often needs to go and check something first; the
  // card they come back to has to still have their text.
  it('keeps a comment draft across closing and reopening the card', async () => {
    const first = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    const composer = await waitFor(() =>
      descriptionEditor(first.container, '.rte-compact .tiptap')
    );
    composer.commands.insertContent('half-written');
    await tick();
    first.unmount();

    const { container } = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await waitFor(() =>
      expect(descriptionEditor(container, '.rte-compact .tiptap').getText()).toBe('half-written')
    );
    expect(screen.getByRole('button', { name: 'Comment' })).not.toBeDisabled();
  });

  it('does not carry a comment draft onto the next card', async () => {
    const { container, rerender } = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    const composer = await waitFor(() => descriptionEditor(container, '.rte-compact .tiptap'));
    composer.commands.insertContent('half-written');
    await tick();

    await rerender({ taskId: T2, closePath: BOARD_PATH });

    await waitFor(() =>
      expect(descriptionEditor(container, '.rte-compact .tiptap').isEmpty).toBe(true)
    );
  });

  // The overlay is reused rather than remounted, so every one of these would
  // otherwise arrive on the next card still holding the last one's answer.
  it('carries none of the previous card’s local state onto the next one', async () => {
    const { rerender } = renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await openQuickAction('Checklist');
    await openHistory();
    await fireEvent.input(screen.getByLabelText('Task title'), {
      target: { value: 'renamed but never committed' },
    });
    expect(screen.getByRole('heading', { name: 'Checklist' })).toBeInTheDocument();
    expect(await screen.findByText(/created this task/)).toBeInTheDocument();

    await rerender({ taskId: T2, closePath: BOARD_PATH });

    expect(screen.getByLabelText('Task title')).toHaveValue('Cut prototype');
    expect(screen.queryByRole('heading', { name: 'Checklist' })).toBeNull();
    expect(screen.queryByText(/created this task/)).toBeNull();
  });

  // Reading the discussion is most of what the card is opened for, so it costs
  // no click; the log behind History is the one thing still worth a request.
  it('opens with the comments shown and History collapsed', async () => {
    const { container } = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await waitFor(() => expect(board.taskComments[T1]).toEqual([comment]));

    expect(screen.getByRole('heading', { name: /^Comments \(/ })).toBeInTheDocument();
    expect(await screen.findByText('first thoughts')).toBeInTheDocument();
    expect(container.querySelector('.rte-compact')).not.toBeNull();
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.queryByText(/created this task/)).toBeNull();
  });

  // Nothing on a fresh card but the title, the bar, the description, the
  // comments and the collapsed History header.
  it('shows no section for a feature the card is not using', async () => {
    board.tasks = board.tasks.map((t) =>
      t.id === T1 ? { ...t, label_ids: [], assignee_ids: [], blocker_ids: [], due_date: null } : t
    );
    renderDetail({ taskId: T2, closePath: BOARD_PATH });

    for (const name of ['Labels', 'Assignees', 'Due date', 'Blocked by', 'Blocks', 'Checklist']) {
      expect(screen.queryByRole('heading', { name })).toBeNull();
    }
    expect(screen.getByRole('heading', { name: 'Description' })).toBeInTheDocument();
  });

  it('reveals an empty checklist from the quick bar and puts the cursor in it', async () => {
    renderDetail({ taskId: T2, closePath: BOARD_PATH });
    expect(screen.queryByRole('heading', { name: 'Checklist' })).toBeNull();

    await openQuickAction('Checklist');

    expect(screen.getByRole('heading', { name: 'Checklist' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Checklist item')).toHaveFocus());
  });

  it('reveals the attachment list from the quick bar and starts the link form', async () => {
    renderDetail({ taskId: T2, closePath: BOARD_PATH });

    await openQuickAction('Attach');
    await fireEvent.click(
      within(screen.getByRole('group', { name: 'Attach' })).getByRole('button', {
        name: 'Add link',
      })
    );

    expect(await screen.findByRole('heading', { name: 'Attachments' })).toBeInTheDocument();
    expect(screen.getByLabelText('Link address')).toBeInTheDocument();
  });

  it('applies a label from the quick bar, and the section appears with it', async () => {
    const spy = vi.spyOn(board, 'setTaskLabels').mockResolvedValue(undefined);
    renderDetail({ taskId: T2, closePath: BOARD_PATH });
    expect(screen.queryByRole('heading', { name: 'Labels' })).toBeNull();

    await openQuickAction('Labels');
    await fireEvent.click(
      within(screen.getByRole('group', { name: 'Add labels' })).getByRole('button', { name: 'art' })
    );

    expect(spy).toHaveBeenCalledWith(T2, ['l1']);
  });

  it('keeps at most one quick-action panel open', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await openQuickAction('Labels');
    expect(screen.getByRole('group', { name: 'Add labels' })).toBeInTheDocument();

    await openQuickAction('Assign');
    expect(screen.queryByRole('group', { name: 'Add labels' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Assign' })).toBeInTheDocument();
  });

  it('offers no quick bar to a viewer or a public reader', () => {
    const { unmount } = renderDetail({ taskId: T1, closePath: BOARD_PATH, readonly: true });
    expect(screen.queryByRole('button', { name: 'Labels' })).toBeNull();
    unmount();

    renderDetail({ taskId: T1, ...publicView });
    expect(screen.queryByRole('button', { name: 'Labels' })).toBeNull();
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

  // On a phone the back gesture is the dismissal, and it unmounts the dialog without
  // ever blurring the field. jsdom models that exactly: unmount() fires no blur, so
  // this is the case a green suite used to say nothing about.
  it('commits an uncommitted title edit when the overlay closes', async () => {
    const update = vi.spyOn(board, 'updateTask').mockResolvedValue({
      status: 'ok',
      updated_at: SERVER_UPDATED_AT,
    });
    const first = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await fireEvent.input(screen.getByLabelText('Task title'), {
      target: { value: 'Design cards v2' },
    });
    first.unmount();

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toBe(T1);
    expect(update.mock.calls[0]![1]).toEqual({ title: 'Design cards v2' });
  });

  it('does not re-send a committed title when the overlay then closes', async () => {
    const update = vi.spyOn(board, 'updateTask').mockResolvedValue({
      status: 'ok',
      updated_at: SERVER_UPDATED_AT,
    });
    const first = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await editTitle('Design cards v2');
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    first.unmount();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(update).toHaveBeenCalledTimes(1);
  });

  // The write would 404, and a refetch that carried it would put the card back on
  // the board — the same reason the description save bails while removing.
  it('does not commit the title of a card being archived', async () => {
    const update = vi.spyOn(board, 'updateTask').mockResolvedValue({
      status: 'ok',
      updated_at: SERVER_UPDATED_AT,
    });
    vi.spyOn(board, 'archiveTask').mockResolvedValue(undefined);
    vi.spyOn(router, 'redirect').mockImplementation(() => {});
    const first = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await fireEvent.input(screen.getByLabelText('Task title'), {
      target: { value: 'Design cards v2' },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    first.unmount();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(update).not.toHaveBeenCalled();
  });

  // The conflict banner already promises this text is safe and unsent until the user
  // chooses; closing the card must not quietly choose for them.
  it('does not commit the title while a conflict is unresolved', async () => {
    conflictDrafts.set(T1, {
      mine: { title: 'Mine', description: null },
      base: { title: 'Design cards', description: null },
    });
    const update = vi.spyOn(board, 'updateTask').mockResolvedValue({
      status: 'ok',
      updated_at: SERVER_UPDATED_AT,
    });
    const first = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await fireEvent.input(screen.getByLabelText('Task title'), {
      target: { value: 'Design cards v2' },
    });
    first.unmount();

    await new Promise((resolve) => setTimeout(resolve, 0));
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

  // The draft is now sent rather than dropped, so "does not carry onto another task"
  // has to mean the write names the card it was typed on — not that nothing happens.
  it('sends a title edit to the task it was typed on, not the next one opened', async () => {
    const update = vi.spyOn(board, 'updateTask').mockResolvedValue({
      status: 'ok',
      updated_at: SERVER_UPDATED_AT,
    });
    const first = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await fireEvent.input(screen.getByLabelText('Task title'), { target: { value: 'Only t1' } });
    first.unmount();

    renderDetail({ taskId: T2, closePath: BOARD_PATH });

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toBe(T1);
    expect(update.mock.calls[0]![1]).toEqual({ title: 'Only t1' });
    expect(screen.getByLabelText('Task title')).toHaveValue('Cut prototype');
  });

  // Switching cards in place — a checklist subtask link, a duplicate — replaces the
  // taskId under a mounted overlay instead of unmounting it.
  it('sends the outgoing title when the card is switched in place', async () => {
    const update = vi.spyOn(board, 'updateTask').mockResolvedValue({
      status: 'ok',
      updated_at: SERVER_UPDATED_AT,
    });
    const { rerender } = render(TaskDetailRouteHost, {
      route: { taskId: T1 },
      closePath: BOARD_PATH,
      taskPath: (id: string) => overlayTaskPath(id),
    });
    await fireEvent.input(screen.getByLabelText('Task title'), { target: { value: 'Only t1' } });

    await rerender({ route: { taskId: T2 } });

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toBe(T1);
    expect(update.mock.calls[0]![1]).toEqual({ title: 'Only t1' });
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

    await openQuickAction('Todo');
    await fireEvent.click(
      within(screen.getByRole('group', { name: 'Move to column' })).getByRole('button', {
        name: 'Done',
      })
    );
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

  it('names the teammate whose edit the stored version came from', async () => {
    users.users = [...users.users, { id: 'u2', name: 'Grace Hopper', avatar_url: null }];
    mockConflict();
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Grace Hopper changed this task/)
    );
  });

  it('names nobody when no logged change matches the stored version', async () => {
    users.users = [...users.users, { id: 'u2', name: 'Grace Hopper', avatar_url: null }];
    // A patch that rewrote a field with the value it already held bumps
    // updated_at without writing a row, so nothing lines up with it.
    mockConflict(undefined, [activityEntry]);
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');

    expect(await screen.findByRole('alert')).toHaveTextContent(/This task changed somewhere else/);
    expect(screen.getByRole('alert')).not.toHaveTextContent('Grace Hopper');
  });

  it('keeps mine against the stored version’s updated_at and clears the banner', async () => {
    mockConflict();
    const { container } = renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');
    await openReview();
    const sent = taskPatches().length;

    mockRoutes();
    await fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));

    await waitFor(() => expect(taskPatches()).toHaveLength(sent + 1));
    expect(await taskPatches()[sent]!.json()).toEqual({
      title: 'Design cards v2',
      // Untouched by this user, so the teammate's copy carries through rather
      // than being offered as a choice nobody made.
      description: teammateVersion().description,
      expected_updated_at: '2026-05-05T00:00:00Z',
    });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByLabelText('Task title')).toHaveValue('Design cards v2');
    expect(container.querySelector('.tiptap')?.textContent).toContain('Their description');
  });

  it('takes two clicks to discard mine, then writes nothing', async () => {
    mockConflict();
    const { container } = renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');
    await openReview();
    const sent = taskPatches().length;

    await fireEvent.click(screen.getByRole('button', { name: 'Keep theirs' }));
    expect(screen.queryByRole('button', { name: 'Keep theirs' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Discard my version' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    // The stored version is already what the server holds, so adopting it is not
    // a write — and does not bump updated_at under every other open editor.
    expect(taskPatches()).toHaveLength(sent);
    expect(screen.getByLabelText('Task title')).toHaveValue('Their title');
    expect(container.querySelector('.tiptap')?.textContent).toContain('Their description');
  });

  it('brings the typed text and the banner back when the card is reopened', async () => {
    mockConflict();
    const first = renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');
    await screen.findByRole('alert');
    first.unmount();

    const { container } = renderDetail({ taskId: T1, closePath: BOARD_PATH });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Task title')).toHaveValue('Design cards v2');
    expect(container.querySelector('.tiptap')?.textContent).not.toContain('Their description');
  });

  it('re-presents a newer stored version when the resolve conflicts again', async () => {
    mockConflict();
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    await editTitle('Design cards v2');
    await openReview();
    const sent = taskPatches().length;

    // The card moved a second time while the resolver was open.
    mockConflict(undefined, [activityEntry]);
    board.tasks = [
      task(T1, 'c1', 'Newer title', { updated_at: '2026-06-06T00:00:00Z' }),
      ...board.tasks.filter((t) => t.id !== T1),
    ];
    await fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));

    await waitFor(() => expect(taskPatches()).toHaveLength(sent + 1));
    expect(await screen.findByText(/changed again while you were reviewing/)).toBeInTheDocument();
    // Still open, still holding the user's text, and no second attempt fired.
    expect(screen.getByRole('heading', { name: 'Review conflicting changes' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(taskPatches()).toHaveLength(sent + 1);
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
        sort_key: null,
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

    board.applyRealtime(realtimeEvent('task_updated', teammateVersion(), PROJECT_ID));
    await tick();
    await editTitle('Design cards v2');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await taskPatches()[0]!.json()).toEqual({
      title: 'Design cards v2',
      expected_updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('keeps its precondition when the route object is replaced but the card is not', async () => {
    // A rename anywhere rewrites the URL, because the path carries the title slug.
    // Reading taskId straight into the reset effect would make that re-run and drop
    // the baseline, and the capture below it would then quietly adopt the version
    // that arrived — handing the next save a precondition it never loaded.
    mockConflict();
    const { rerender } = render(TaskDetailRouteHost, {
      route: { taskId: T1 },
      closePath: BOARD_PATH,
      taskPath: (id: string) => overlayTaskPath(id),
    });

    board.applyRealtime(realtimeEvent('task_updated', teammateVersion(), PROJECT_ID));
    await rerender({ route: { taskId: T1 } });
    await editTitle('Design cards v2');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await taskPatches()[0]!.json()).toEqual({
      title: 'Design cards v2',
      expected_updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('sets the due date from the quick bar, and shows no section until there is one', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    expect(screen.queryByRole('heading', { name: 'Due date' })).toBeNull();

    await openQuickAction('Due date');
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

describe('TaskDetail cross-project dependencies', () => {
  const FAR = testUuid('far1');

  function farEdge(overrides: Record<string, unknown> = {}) {
    return {
      task_id: FAR,
      project_id: testUuid('p2'),
      project_name: 'Engineering',
      title: 'Ship the API',
      is_done: false,
      ...overrides,
    };
  }

  it('counts remote blockers in the open-task badge', async () => {
    board.tasks = board.tasks.map((t) =>
      t.id === T1 ? { ...t, blocker_ids: [T2], open_cross_project_blocker_count: 2 } : t
    );
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    // One open local blocker plus two remote ones.
    expect(await screen.findByText('3 open tasks')).toBeInTheDocument();
  });

  it('holds a skeleton row per known remote blocker, then fills it in', async () => {
    board.tasks = board.tasks.map((t) =>
      t.id === T1 ? { ...t, blocker_ids: [], open_cross_project_blocker_count: 1 } : t
    );
    crossProjectResponse = { ...crossProjectResponse, blocked_by: [farEdge()] };

    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    const list = screen.getByRole('list', { name: 'Blocked by' });
    expect(list).toHaveAttribute('aria-busy', 'true');

    await waitFor(() => expect(list).toHaveAttribute('aria-busy', 'false'));
    expect(within(list).getByRole('link', { name: 'Ship the API' })).toHaveAttribute(
      'href',
      taskHref(FAR, 'Ship the API')
    );
    expect(within(list).getByText('Engineering')).toBeInTheDocument();
  });

  it('never names an edge into a project the viewer cannot read', async () => {
    board.tasks = board.tasks.map((t) =>
      t.id === T1 ? { ...t, blocker_ids: [], open_cross_project_blocker_count: 1 } : t
    );
    crossProjectResponse = { ...crossProjectResponse, hidden_blocked_by_count: 1 };

    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    const list = screen.getByRole('list', { name: 'Blocked by' });
    expect(await within(list).findByText('1 task in another project')).toBeInTheDocument();
    expect(within(list).queryAllByRole('link')).toEqual([]);
  });

  it('pluralizes the unreadable row without claiming they share a project', async () => {
    crossProjectResponse = { ...crossProjectResponse, hidden_blocked_by_count: 3 };
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    expect(await screen.findByText('3 tasks in other projects')).toBeInTheDocument();
  });

  it('shows remote dependents, which no board payload hints at', async () => {
    crossProjectResponse = {
      ...crossProjectResponse,
      blocking: [farEdge({ title: 'Write the docs' })],
    };
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    const list = await screen.findByRole('list', { name: 'Blocks' });
    expect(await within(list).findByRole('link', { name: 'Write the docs' })).toBeInTheDocument();
  });

  it('offers no Remove on a remote row', async () => {
    crossProjectResponse = { ...crossProjectResponse, blocked_by: [farEdge()] };
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    const list = screen.getByRole('list', { name: 'Blocked by' });
    await within(list).findByRole('link', { name: 'Ship the API' });
    const remoteRow = within(list).getByRole('link', { name: 'Ship the API' }).closest('li');
    expect(within(remoteRow as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('strikes through a remote blocker that is already done', async () => {
    crossProjectResponse = {
      ...crossProjectResponse,
      blocked_by: [farEdge({ is_done: true })],
    };
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    const remoteLink = await screen.findByRole('link', { name: 'Ship the API' });
    expect(remoteLink.className).toContain('line-through');
  });

  it('offers a retry when the fetch fails', async () => {
    mockRoutes((request, url) =>
      request.method === 'GET' && url.pathname.endsWith('/cross-project-dependencies')
        ? jsonResponse(500, { error: 'boom' })
        : undefined
    );
    renderDetail({ taskId: T1, closePath: BOARD_PATH });

    const retry = await screen.findByRole('button', { name: 'Try again' });
    mockRoutes();
    await fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull());
  });

  it('asks for nothing on a public board', async () => {
    board.readonly = true;
    renderDetail({ taskId: T1, ...publicView });
    await tick();

    const asked = fetchMock.mock.calls
      .map((call) => new URL((call[0] as Request).url).pathname)
      .filter((path) => path.endsWith('/cross-project-dependencies'));
    expect(asked).toEqual([]);
  });
});

describe('TaskDetail and what changed since you last looked', () => {
  it('takes the card it opens out of the capture, and the next one when it switches', async () => {
    board.changedTaskIds.add(T1);
    board.changedTaskIds.add(T2);

    const { rerender } = renderDetail({ taskId: T1, closePath: BOARD_PATH });
    await tick();
    expect([...board.changedTaskIds]).toEqual([T2]);

    await rerender({ taskId: T2, closePath: BOARD_PATH });
    expect([...board.changedTaskIds]).toEqual([]);
  });

  it('takes it out for a viewer, who is shown the tint too', async () => {
    board.changedTaskIds.add(T1);

    renderDetail({ taskId: T1, closePath: BOARD_PATH, readonly: true });
    await tick();

    expect([...board.changedTaskIds]).toEqual([]);
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

    expect(screen.queryByRole('heading', { name: 'Attachments' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Attach file' })).toBeNull();
    expect(screen.queryByAltText('mock.png')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete task' })).toBeNull();
    expect(screen.queryByText(/Created .+ · Updated .+/)).toBeNull();
    expect(screen.queryByText('History')).toBeNull();

    await waitFor(() => expect(screen.getByText('Todo')).toBeVisible());
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

    const posted = await screen.findByText('first thoughts');
    expect(within(posted.closest('li')!).getByText('Ada Lovelace')).toBeInTheDocument();

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
    const { container } = renderDetail({ taskId: T1, closePath: BOARD_PATH, readonly: true });

    expect(screen.queryByLabelText('Task title')).toBeNull();
    expect(screen.queryByLabelText('Column')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Attach file' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete task' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add label' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove blocking task/ })).toBeNull();

    expect(await screen.findByText('first thoughts')).toBeInTheDocument();
    expect(container.querySelector('.rte-compact')).not.toBeNull();

    await openHistory();
    expect(await screen.findByText(/Created .+ · Updated .+/)).toBeInTheDocument();
  });

  it('shows attached images without the cover or delete controls', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH, readonly: true });

    expect(await screen.findByAltText('mock.png')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /as cover$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete image/ })).toBeNull();
  });

  it('mounts one read-only Attachments section holding the images', async () => {
    renderDetail({ taskId: T1, closePath: BOARD_PATH, readonly: true });

    await screen.findByRole('heading', { name: 'Attachments' });
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toContain('Attachments');
    expect(headings).not.toContain('Images');
    expect(screen.queryByRole('button', { name: 'Attach file' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add link' })).toBeNull();

    // An image is still something attached, so the empty copy stays away.
    expect(await screen.findByAltText('mock.png')).toBeInTheDocument();
    expect(screen.queryByText('No attachments.')).toBeNull();
  });
});
