import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import PublicBoard from './PublicBoard.svelte';
import { board } from '../lib/board.svelte';
import { router } from '../lib/router.svelte';
import { users } from '../lib/users.svelte';

const PROJECT_ID = 'p-public';

function payload() {
  return {
    project: { id: PROJECT_ID, name: 'Roadmap', description: 'What is coming' },
    columns: [
      { id: 'todo', name: 'To Do', position: 1000, is_done: false },
      { id: 'done', name: 'Shipped', position: 2000, is_done: true },
    ],
    tasks: [
      {
        id: 't1',
        column_id: 'todo',
        title: 'Design cards',
        description: null,
        position: 1000,
        label_ids: [],
        assignee_ids: ['u-ada'],
        blocker_ids: [],
        image_count: 0,
      },
      {
        id: 't2',
        column_id: 'done',
        title: 'Pick a name',
        description: null,
        position: 1000,
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        image_count: 0,
      },
    ],
    labels: [],
    users: [{ id: 'u-ada', name: 'Ada Lovelace', avatar_url: null }],
  };
}

function mockPublicApi(response: Response): void {
  fetchMock.mockImplementation(async () => response.clone());
}

function requestedPaths(): string[] {
  return fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
}

function robotsMeta(): HTMLMetaElement | null {
  return document.head.querySelector('meta[name="robots"]');
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  users.reset();
  router.navigate('/', { replace: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PublicBoard', () => {
  it('renders the board read-only from the public endpoint', async () => {
    mockPublicApi(jsonResponse(200, payload()));

    render(PublicBoard, { props: { projectId: PROJECT_ID } });

    expect(await screen.findByRole('heading', { name: 'Roadmap' })).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('Shipped')).toBeInTheDocument();
    expect(screen.getByText('Design cards')).toBeInTheDocument();
    expect(screen.getByText('Pick a name')).toBeInTheDocument();
    expect(screen.getByTitle('Ada Lovelace')).toHaveTextContent('AL');
    expect(screen.getByRole('link', { name: /Design cards/ })).toHaveAttribute(
      'href',
      `/public/projects/${PROJECT_ID}/tasks/t1`
    );

    expect(requestedPaths()).toEqual([`/api/public/projects/${PROJECT_ID}/board`]);
    expect(requestedPaths().some((path) => path.startsWith('/api/projects/'))).toBe(false);
    expect(requestedPaths()).not.toContain('/api/users');
  });

  it('offers no editing affordances and no app chrome of its own', async () => {
    mockPublicApi(jsonResponse(200, payload()));

    render(PublicBoard, { props: { projectId: PROJECT_ID } });

    await screen.findByText('Design cards');
    expect(screen.queryByRole('button', { name: '+ Add column' })).toBeNull();
    expect(screen.queryByTitle('Rename column')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete column' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    expect(screen.queryByLabelText('Filter tasks by title')).toBeNull();
  });

  it('mounts a noindex robots tag while rendered and removes it on unmount', async () => {
    mockPublicApi(jsonResponse(200, payload()));

    const view = render(PublicBoard, { props: { projectId: PROJECT_ID } });
    await screen.findByText('Design cards');

    expect(robotsMeta()?.content).toBe('noindex, nofollow');

    view.unmount();
    expect(robotsMeta()).toBeNull();
  });

  it('shows the server message when the board is not public and renders no columns', async () => {
    mockPublicApi(jsonResponse(404, { error: 'This board is not public' }));

    render(PublicBoard, { props: { projectId: PROJECT_ID } });

    expect(await screen.findByText('This board is not public')).toBeInTheDocument();
    expect(screen.queryByText('To Do')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Roadmap' })).toBeNull();
  });

  it('opens the read-only card detail for a task in the path', async () => {
    mockPublicApi(jsonResponse(200, payload()));

    render(PublicBoard, { props: { projectId: PROJECT_ID, taskId: 't1' } });

    expect(await screen.findByRole('heading', { name: 'Design cards' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Task title')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete task' })).toBeNull();
    expect(requestedPaths()).not.toContain('/api/tasks/t1');
  });

  it('drops the assignee-only user cache on unmount', async () => {
    mockPublicApi(jsonResponse(200, payload()));

    const view = render(PublicBoard, { props: { projectId: PROJECT_ID } });
    await screen.findByText('Design cards');
    expect(users.forProject(PROJECT_ID)).toHaveLength(1);

    view.unmount();

    await waitFor(() => expect(users.forProject(PROJECT_ID)).toEqual([]));
  });
});
