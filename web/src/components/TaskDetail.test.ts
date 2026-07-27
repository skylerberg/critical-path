import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Editor } from '@tiptap/core';
import TaskDetail from './TaskDetail.svelte';
import { board } from '../lib/board.svelte';
import { drafts } from '../lib/drafts.svelte';
import { router } from '../lib/router.svelte';
import { taskActivity } from '../lib/taskActivity.svelte';
import { users } from '../lib/users.svelte';
import type { BoardTask } from '../lib/board-types';

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
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    comment_count: 0,
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
  task_id: 't1',
  user_id: 'u1',
  body: {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first thoughts' }] }],
  },
  created_at: '2026-01-03T00:00:00Z',
  updated_at: '2026-01-03T00:00:00Z',
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
  drafts.clearAll();
  users.reset();
  board.currentProjectId = 'p1';
  board.project = {
    id: 'p1',
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: null,
    member_ids: [],
    is_public: false,
    created_at: '2026-01-01T00:00:00Z',
  };
  board.columns = [
    { id: 'c1', name: 'Todo', position: 1000, is_done: false },
    { id: 'c2', name: 'Done', position: 2000, is_done: true },
  ];
  board.tasks = [
    task('t1', 'c1', 'Design cards', {
      label_ids: ['l1'],
      assignee_ids: ['u1'],
      blocker_ids: ['t2', 't3'],
      image_count: 1,
    }),
    task('t2', 'c1', 'Cut prototype'),
    task('t3', 'c2', 'Buy sleeves', { position: 5000 }),
    task('t4', 'c1', 'Playtest session', { blocker_ids: ['t1'] }),
  ];
  board.labels = [
    { id: 'l1', name: 'art', color: '#ff0000' },
    { id: 'l2', name: 'rules', color: '#00ff00' },
  ];
  users.users = [{ id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace', avatar_url: null }];
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
    if (request.method === 'GET' && url.pathname === '/api/tasks/t1') {
      return jsonResponse(200, {
        ...board.tasks[0],
        project_id: 'p1',
        images: [image],
        comments: [comment],
      });
    }
    if (request.method === 'GET' && url.pathname.endsWith('/activity')) {
      return jsonResponse(200, {
        activity: url.pathname === '/api/tasks/t1/activity' ? [activityEntry] : [],
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/users') {
      return jsonResponse(200, { users: users.users });
    }
    if (request.method === 'GET' && url.pathname === '/api/projects/p1') {
      return jsonResponse(200, {
        project: board.project,
        columns: board.columns,
        tasks: board.tasks,
        labels: board.labels,
      });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/tasks/t1') {
      const existing = board.tasks.find((t) => t.id === 't1') ?? task('t1', 'c1', 'Design cards');
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
      (request) => request.method === 'PATCH' && new URL(request.url).pathname === '/api/tasks/t1'
    );
}

function teammateVersion(): BoardTask {
  return task('t1', 'c1', 'Their title', {
    label_ids: ['l1'],
    assignee_ids: ['u1'],
    blocker_ids: ['t2', 't3'],
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
    if (request.method === 'PATCH' && url.pathname === '/api/tasks/t1') {
      return patchResponse();
    }
    if (request.method === 'GET' && url.pathname === '/api/projects/p1') {
      return jsonResponse(200, {
        project: board.project,
        columns: board.columns,
        tasks: [teammateVersion(), ...board.tasks.filter((t) => t.id !== 't1')],
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
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

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
    expect(screen.getByRole('button', { name: 'Delete task' })).toBeInTheDocument();
  });

  it('loads images and comments from the one detail fetch and renders the Activity section', async () => {
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    await waitFor(() => expect(board.taskComments.t1).toEqual([comment]));
    expect(board.taskImages.t1).toEqual([image]);
    expect(await screen.findByText('first thoughts')).toBeInTheDocument();
  });

  it('loads the activity log and interleaves it with the comments', async () => {
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    await waitFor(() => expect(taskActivity.entries).toEqual([activityEntry]));
    expect(await screen.findByText(/created this task/)).toBeInTheDocument();
    const stream = screen.getAllByRole('listitem').filter((item) => item.textContent !== null);
    const created = stream.findIndex((item) => item.textContent!.includes('created this task'));
    const written = stream.findIndex((item) => item.textContent!.includes('first thoughts'));
    expect(created).toBeGreaterThanOrEqual(0);
    expect(created).toBeLessThan(written);
  });

  it('drops the previous task’s log when the overlay switches task', async () => {
    const { rerender } = render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });
    await waitFor(() => expect(taskActivity.entries).toEqual([activityEntry]));

    await rerender({ taskId: 't2', closePath: '/projects/p1' });
    await waitFor(() => expect(taskActivity.entries).toEqual([]));
    expect(
      fetchMock.mock.calls.some(
        (call) => new URL((call[0] as Request).url).pathname === '/api/tasks/t2/activity'
      )
    ).toBe(true);
  });

  it('drops the log on unmount and stops refetching it for the closed overlay', async () => {
    const { unmount } = render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });
    await waitFor(() => expect(taskActivity.entries).toEqual([activityEntry]));

    unmount();
    await tick();
    expect(taskActivity.entries).toEqual([]);

    const sent = activityRequests('t1').length;
    vi.useFakeTimers();
    try {
      taskActivity.invalidate('t1');
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
    expect(activityRequests('t1')).toHaveLength(sent);
  });

  it('renders the column select with the current column and all columns as options', () => {
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    const select = screen.getByLabelText('Column');
    expect(select).toHaveValue('c1');
    expect(screen.getByRole('option', { name: 'Todo' })).toHaveValue('c1');
    expect(screen.getByRole('option', { name: 'Done' })).toHaveValue('c2');
  });

  it('moves the task to the bottom of the selected column', async () => {
    const spy = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    await fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'c2' } });

    expect(spy).toHaveBeenCalledWith('t1', 'c2', 6000);
  });

  it('does not move the task when the current column is re-selected', async () => {
    const spy = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    await fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'c1' } });

    expect(spy).not.toHaveBeenCalled();
  });

  it('shows a fallback when the task is not in the store', () => {
    render(TaskDetail, { taskId: 'missing', closePath: '/projects/p1' });

    expect(screen.getByText('Task not found')).toBeInTheDocument();
  });

  it('waits for the delete to finish before redirecting, so the DELETE is never aborted', async () => {
    let resolveDelete: (() => void) | undefined;
    const deleteSpy = vi.spyOn(board, 'deleteTask').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );
    const redirectSpy = vi.spyOn(router, 'redirect').mockImplementation(() => {});

    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    expect(deleteSpy).toHaveBeenCalledWith('t1');
    expect(redirectSpy).not.toHaveBeenCalled();

    resolveDelete?.();
    await waitFor(() => expect(redirectSpy).toHaveBeenCalledWith('/projects/p1'));
  });

  it('archives without a confirm step, then redirects once the card is off the board', async () => {
    const redirectSpy = vi.spyOn(router, 'redirect').mockImplementation(() => {});
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/tasks/t1/archive'
        ? jsonResponse(200, {
            ...task('t1', 'c1', 'Design cards'),
            archived_at: '2026-03-01T12:00:00Z',
          })
        : undefined
    );

    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(redirectSpy).toHaveBeenCalledWith('/projects/p1'));
    expect(board.tasks.some((t) => t.id === 't1')).toBe(false);
    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t1']);
    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).toContain('/api/tasks/t1/archive');
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

    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(archiveSpy).toHaveBeenCalledWith('t1');
    expect(redirectSpy).not.toHaveBeenCalled();

    resolveArchive?.();
    await waitFor(() => expect(redirectSpy).toHaveBeenCalledWith('/projects/p1'));
  });

  it('discards an uncommitted title edit when the overlay closes', async () => {
    const update = vi.spyOn(board, 'updateTask').mockResolvedValue({
      status: 'ok',
      updated_at: SERVER_UPDATED_AT,
    });
    const first = render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });
    await fireEvent.input(screen.getByLabelText('Task title'), {
      target: { value: 'Design cards v2' },
    });
    first.unmount();
    expect(update).not.toHaveBeenCalled();

    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });
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
    const first = render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });
    await fireEvent.input(screen.getByLabelText('Task title'), { target: { value: 'Scrapped' } });

    await fireEvent(document.querySelector('dialog')!, new Event('cancel', { cancelable: true }));

    first.unmount();

    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });
    expect(screen.getByLabelText('Task title')).toHaveValue('Design cards');
    expect(update).not.toHaveBeenCalled();
  });

  it('does not carry a title edit onto another task', async () => {
    const first = render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });
    await fireEvent.input(screen.getByLabelText('Task title'), { target: { value: 'Only t1' } });
    first.unmount();

    render(TaskDetail, { taskId: 't2', closePath: '/projects/p1' });

    expect(screen.getByLabelText('Task title')).toHaveValue('Cut prototype');
  });

  it('sends the loaded updated_at as the precondition when committing a title', async () => {
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    await editTitle('Design cards v2');

    await waitFor(() => expect(taskPatches()).toHaveLength(1));
    expect(await taskPatches()[0]!.json()).toEqual({
      title: 'Design cards v2',
      expected_updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('advances the precondition to the response updated_at after a successful save', async () => {
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

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
      if (request.method === 'PATCH' && url.pathname === '/api/tasks/t1') {
        patches += 1;
        const saved = (): Response =>
          jsonResponse(200, { ...board.tasks[0], updated_at: SERVER_UPDATED_AT });
        return patches === 1 ? held.then(saved) : saved();
      }
      return undefined;
    });
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

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
      if (request.method === 'PATCH' && url.pathname === '/api/tasks/t1') {
        patches += 1;
        const saved = (): Response =>
          jsonResponse(200, { ...board.tasks[0], updated_at: SERVER_UPDATED_AT });
        return patches === 1 ? held.then(saved) : saved();
      }
      return undefined;
    });
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

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
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    await editTitle('Design cards v2');
    await fireEvent.blur(screen.getByLabelText('Task title'));
    release?.();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Task title')).toHaveValue('Design cards v2');
    expect(taskPatches()).toHaveLength(1);
  });

  it('does not adopt a new precondition from a column change', async () => {
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

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
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    await editTitle('Design cards v2');

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed somewhere else/);
    expect(screen.getByLabelText('Task title')).toHaveValue('Design cards v2');
  });

  it('sends nothing further while conflicted', async () => {
    mockConflict();
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    await editTitle('Design cards v2');
    await screen.findByRole('alert');
    const sent = taskPatches().length;

    await editTitle('Design cards v3');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(taskPatches()).toHaveLength(sent);
  });

  it('reloads the server title and description and clears the banner', async () => {
    mockConflict();
    const { container } = render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

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

  it('sends the loaded updated_at as the precondition when saving the description', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });
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
      const { container } = render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });
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
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    board.applyRealtime({ type: 'task_updated', project_id: 'p1', data: teammateVersion() });
    await tick();
    await editTitle('Design cards v2');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await taskPatches()[0]!.json()).toEqual({
      title: 'Design cards v2',
      expected_updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('lists tasks that depend on this one and removes the reverse relation', async () => {
    const spy = vi.spyOn(board, 'removeBlocker').mockResolvedValue(undefined);
    render(TaskDetail, { taskId: 't1', closePath: '/projects/p1' });

    expect(screen.getByRole('heading', { name: 'Blocks' })).toBeInTheDocument();
    const remove = screen.getByRole('button', { name: 'Remove blocked task Playtest session' });
    await fireEvent.click(remove);

    expect(spy).toHaveBeenCalledWith('t4', 't1');
  });
});

describe('TaskDetail readonly', () => {
  beforeEach(() => {
    users.setForProject('p1', [{ id: 'u1', name: 'Ada Lovelace', avatar_url: null, email: '' }]);
  });

  it('renders the card as text with no editing surface and no authenticated fetches', async () => {
    render(TaskDetail, { taskId: 't1', closePath: '/public/projects/p1', readonly: true });

    expect(screen.queryByLabelText('Task title')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Design cards' })).toBeInTheDocument();

    expect(screen.queryByLabelText('Column')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Column' })).toBeInTheDocument();
    expect(screen.getByText('Todo')).toBeInTheDocument();

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

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Column' })).toBeVisible());
    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).not.toContain('/api/tasks/t1');
    expect(paths).not.toContain('/api/users');
  });

  it('renders the description read-only, with no formatting toolbar', async () => {
    board.tasks = board.tasks.map((t) =>
      t.id === 't1'
        ? {
            ...t,
            description: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship it' }] }],
            },
          }
        : t
    );

    render(TaskDetail, { taskId: 't1', closePath: '/public/projects/p1', readonly: true });

    expect(await screen.findByText('Ship it')).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull();
    expect(document.querySelector('.tiptap')).toHaveAttribute('contenteditable', 'false');
  });

  it('never writes, so it sends no precondition and never banners a conflict', async () => {
    vi.useFakeTimers();
    try {
      board.tasks = board.tasks.map((t) =>
        t.id === 't1'
          ? {
              ...t,
              description: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship it' }] }],
              },
            }
          : t
      );

      const { container } = render(TaskDetail, {
        taskId: 't1',
        closePath: '/public/projects/p1',
        readonly: true,
      });
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
    board.tasks = [...board.tasks, task('t5', 'c1', 'Bare card')];

    render(TaskDetail, { taskId: 't5', closePath: '/public/projects/p1', readonly: true });

    expect(screen.getByRole('heading', { name: 'Bare card' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Description' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Labels' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Assignees' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Blocked by' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Blocks' })).toBeNull();
  });
});
