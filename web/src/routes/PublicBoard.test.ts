import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import PublicBoard from './PublicBoard.svelte';
import { board } from '../lib/board.svelte';
import { matchRoute, router } from '../lib/router.svelte';
import { publicBoardHref, publicTaskHref } from '../lib/short-links';
import { testUuid } from '../lib/test-ids';
import { users } from '../lib/users.svelte';

const PROJECT_ID = testUuid('p-public');
const DESIGN_CARDS_ID = testUuid('t1');
const PICK_A_NAME_ID = testUuid('t2');

function payload() {
  return {
    project: { id: PROJECT_ID, name: 'Roadmap', description: 'What is coming' },
    columns: [
      { id: 'todo', name: 'To Do', position: 1000, sort_key: 'V0000010001', is_done: false },
      { id: 'done', name: 'Shipped', position: 2000, sort_key: 'V0000020001', is_done: true },
    ],
    tasks: [
      {
        id: DESIGN_CARDS_ID,
        column_id: 'todo',
        title: 'Design cards',
        description: null,
        sort_key: 'V0000010001',
        due_date: '2020-01-04',
        label_ids: [],
        assignee_ids: ['u-ada'],
        blocker_ids: [],
        image_count: 1,
        cover_image_url: '/api/images/img1',
        comment_count: 2,
      },
      {
        id: PICK_A_NAME_ID,
        column_id: 'done',
        title: 'Pick a name',
        description: null,
        sort_key: 'V0000010001',
        due_date: null,
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        image_count: 0,
        cover_image_url: null,
        comment_count: 0,
      },
    ],
    labels: [],
    users: [
      { id: 'u-ada', name: 'Ada Lovelace', avatar_url: null },
      { id: 'u-bo', name: 'Bo Peep', avatar_url: null },
    ],
    comments: [
      {
        id: 'cm1',
        task_id: DESIGN_CARDS_ID,
        user_id: 'u-ada',
        body: commentBody('Locking the layout this week'),
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'cm2',
        task_id: DESIGN_CARDS_ID,
        user_id: 'u-bo',
        body: commentBody('Sounds right to me'),
        created_at: '2026-01-02T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    ],
  };
}

function commentBody(text: string) {
  return {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
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
      publicTaskHref(PROJECT_ID, DESIGN_CARDS_ID)
    );

    expect(requestedPaths()).toEqual([`/api/public/projects/${PROJECT_ID}/board`]);
    expect(requestedPaths().some((path) => path.startsWith('/api/projects/'))).toBe(false);
    expect(requestedPaths()).not.toContain('/api/users');
  });

  it('renders a published cover image on the card', async () => {
    mockPublicApi(jsonResponse(200, payload()));

    render(PublicBoard, { props: { projectId: PROJECT_ID } });

    await screen.findByText('Design cards');
    const covers = document.querySelectorAll('img[src^="/api/images/"]');
    expect(covers).toHaveLength(1);
    expect(covers[0]).toHaveAttribute('src', '/api/images/img1');
  });

  it('offers no editing affordances', async () => {
    mockPublicApi(jsonResponse(200, payload()));

    render(PublicBoard, { props: { projectId: PROJECT_ID } });

    await screen.findByText('Design cards');
    expect(screen.queryByRole('button', { name: '+ Add column' })).toBeNull();
    expect(screen.queryByTitle('Rename column')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Options for Design cards' })).toBeNull();
  });

  it('shows a published due date as an inert pill', async () => {
    mockPublicApi(jsonResponse(200, payload()));

    render(PublicBoard, { props: { projectId: PROJECT_ID } });

    await screen.findByText('Design cards');
    const pills = screen.getAllByTitle(/^Due /);
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveTextContent('2020');
    expect(pills[0]!.tagName).toBe('SPAN');
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
    expect(screen.getByText(/turned off by the board's owner/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText('To Do')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Roadmap' })).toBeNull();
  });

  it('offers a retry instead of blaming the owner when the load simply failed', async () => {
    mockPublicApi(jsonResponse(500, { error: 'Something went wrong' }));

    render(PublicBoard, { props: { projectId: PROJECT_ID } });

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByText(/turned off by the board's owner/)).toBeNull();

    mockPublicApi(jsonResponse(200, payload()));
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Roadmap' })).toBeInTheDocument();
  });

  it('opens the read-only card detail for a task in the path', async () => {
    mockPublicApi(jsonResponse(200, payload()));

    render(PublicBoard, { props: { projectId: PROJECT_ID, taskId: DESIGN_CARDS_ID } });

    expect(await screen.findByRole('heading', { name: 'Design cards' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Task title')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete task' })).toBeNull();
    expect(requestedPaths()).not.toContain(`/api/tasks/${DESIGN_CARDS_ID}`);
  });

  it('reads the comment stream out of the board payload, with no second request', async () => {
    mockPublicApi(jsonResponse(200, payload()));

    render(PublicBoard, { props: { projectId: PROJECT_ID, taskId: DESIGN_CARDS_ID } });

    expect(await screen.findByText('Locking the layout this week')).toBeInTheDocument();
    expect(screen.getByText('Sounds right to me')).toBeInTheDocument();
    expect(screen.getByText('Bo Peep')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();

    expect(requestedPaths()).toEqual([`/api/public/projects/${PROJECT_ID}/board`]);
  });

  it('counts comments on the card face', async () => {
    mockPublicApi(jsonResponse(200, payload()));

    render(PublicBoard, { props: { projectId: PROJECT_ID } });

    await screen.findByText('Design cards');
    expect(screen.getByTitle('2 comments')).toBeInTheDocument();
    expect(screen.queryByTitle('0 comments')).toBeNull();
  });

  it('drops the assignee-only user cache on unmount', async () => {
    mockPublicApi(jsonResponse(200, payload()));

    const view = render(PublicBoard, { props: { projectId: PROJECT_ID } });
    await screen.findByText('Design cards');
    expect(users.forProject(PROJECT_ID)).toHaveLength(2);

    view.unmount();

    await waitFor(() => expect(users.forProject(PROJECT_ID)).toEqual([]));
  });

  it('routes the alias links it renders and 404s the raw-uuid form', () => {
    expect(matchRoute(publicBoardHref(PROJECT_ID))).toEqual({
      name: 'public-board',
      params: { id: PROJECT_ID },
    });
    expect(matchRoute(publicTaskHref(PROJECT_ID, DESIGN_CARDS_ID))).toEqual({
      name: 'public-board',
      params: { id: PROJECT_ID, taskId: DESIGN_CARDS_ID },
    });
    expect(matchRoute(`/public/projects/${PROJECT_ID}`).name).toBe('not-found');
  });
});
