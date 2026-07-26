import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import TaskDetail from './TaskDetail.svelte';
import { board } from '../lib/board.svelte';
import { drafts } from '../lib/drafts.svelte';
import { router } from '../lib/router.svelte';
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

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  board.taskImages = {};
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
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/tasks/t1') {
      return jsonResponse(200, {
        ...board.tasks[0],
        project_id: 'p1',
        images: [image],
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/users') {
      return jsonResponse(200, { users: users.users });
    }
    return jsonResponse(204);
  });
});

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

  it('discards an uncommitted title edit when the overlay closes', async () => {
    const update = vi.spyOn(board, 'updateTask').mockResolvedValue(true);
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
    const update = vi.spyOn(board, 'updateTask').mockResolvedValue(true);
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
