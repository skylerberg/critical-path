import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Projects from './Projects.svelte';
import { invitations } from '../lib/invitations.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { noFilters } from '../lib/board-filters';
import { router } from '../lib/router.svelte';
import { session } from '../lib/session.svelte';
import { users } from '../lib/users.svelte';

// jsdom does not implement <dialog> show/close methods.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
};

function project(overrides: Partial<Project> = {}): Project {
  const memberIds = overrides.member_ids ?? [];
  return {
    id: 'p-1',
    name: 'Alpha',
    description: '',
    archived_at: null,
    created_by: null,
    member_ids: memberIds,
    members: memberIds.map((user_id) => ({ user_id, role: 'editor' as const })),
    is_public: false,
    created_at: '2026-01-01T00:00:00.000Z',
    open_task_count: 0,
    done_task_count: 0,
    position: null,
    ...overrides,
  };
}

const me = { id: 'u-me', email: 'me@example.com', name: 'Me', avatar_url: null };
const ada = { id: 'u-ada', email: 'ada@example.com', name: 'Ada', avatar_url: null };

// The share modal loads the pending list for an editor, so tests that open it
// still need a well-formed answer for that one request.
function mockApi(handler: (request: Request, url: URL) => Response): void {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const url = new URL(request.url);
    return url.pathname.endsWith('/invitations')
      ? jsonResponse(200, { invitations: [] })
      : handler(request, url);
  });
}

const activeProject = project({
  id: 'p-active',
  name: 'Alpha',
  description: 'A deck-building game',
  created_by: me.id,
  open_task_count: 5,
  done_task_count: 3,
});
const archivedProject = project({
  id: 'p-archived',
  name: 'Old prototype',
  archived_at: '2026-02-01T00:00:00.000Z',
  created_at: '2026-01-03T00:00:00.000Z',
});

beforeEach(() => {
  fetchMock.mockReset();
  invitations.reset();
  projects.reset();
  users.reset();
  session.user = me;
  router.beforeNavigate = undefined;
  router.navigate('/', { replace: true });
});

describe('Projects', () => {
  it('renders cards with counts and a collapsed archived section', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { projects: [activeProject, archivedProject] })
    );
    render(Projects);

    expect(await screen.findByRole('link', { name: 'Alpha' })).toHaveAttribute(
      'href',
      '/projects/p-active'
    );
    expect(screen.getByText('A deck-building game')).toBeInTheDocument();
    expect(screen.getByText('5 open')).toBeInTheDocument();
    expect(screen.getByText('3 done')).toBeInTheDocument();

    expect(screen.queryByRole('link', { name: 'Old prototype' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Archived (1)' }));
    expect(screen.getByRole('link', { name: 'Old prototype' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Options for Old prototype' }));
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument();
  });

  it('renders each project as a single compact card', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [activeProject] }));
    render(Projects);

    const card = (await screen.findByRole('link', { name: 'Alpha' })).closest('article')!;
    const inCard = within(card);
    expect(inCard.getByRole('link', { name: 'Alpha' })).toBeInTheDocument();
    expect(inCard.getByText('A deck-building game')).toBeInTheDocument();
    expect(inCard.getByText('5 open')).toBeInTheDocument();
    expect(inCard.getByText('3 done')).toBeInTheDocument();
    expect(inCard.getByRole('button', { name: 'Options for Alpha' })).toBeInTheDocument();

    expect(card).toHaveClass('items-center');
    expect(card.querySelector('div')).toHaveClass('py-1');
  });

  it('keeps the full project name available when the title truncates', async () => {
    const longName = 'Alpha '.repeat(20).trim();
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { projects: [project({ id: 'p-long', name: longName })] })
    );
    render(Projects);

    const cardLink = await screen.findByRole('link', { name: longName });
    expect(cardLink).toHaveAttribute('title', longName);
    expect(cardLink.closest('h3')).toHaveClass('truncate');
  });

  it('hangs the tooltip on the anchor that the card-wide overlay hit-tests to', async () => {
    const longDescription = 'A deck-building game about deck-building games. '.repeat(9).trim();
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        projects: [project({ id: 'p-wordy', description: longDescription })],
      })
    );
    render(Projects);

    const cardLink = await screen.findByRole('link', { name: 'Alpha' });
    expect(cardLink).toHaveAttribute('title', `Alpha\n${longDescription}`);

    const paragraph = screen.getByText(longDescription);
    expect(paragraph).toHaveClass('line-clamp-2');
    expect(paragraph).not.toHaveAttribute('title');
    expect(cardLink.closest('h3')).not.toHaveAttribute('title');
  });

  it('omits the description line when a project has none', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { projects: [project({ id: 'p-plain', name: 'Plain' })] })
    );
    render(Projects);

    const card = (await screen.findByRole('link', { name: 'Plain' })).closest('article')!;
    expect(card.querySelectorAll('p')).toHaveLength(0);
  });

  it('pins the compact grid and page container classes', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [activeProject] }));
    render(Projects);

    const card = (await screen.findByRole('link', { name: 'Alpha' })).closest('article')!;
    expect(card.parentElement).toHaveClass(
      'grid',
      'grid-cols-1',
      'gap-2',
      'sm:grid-cols-2',
      'xl:grid-cols-3',
      '2xl:grid-cols-4'
    );
    expect(card.closest('main')).toHaveClass('max-w-7xl', 'gap-6');
  });

  it('keeps the options button outside the card link', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [activeProject] }));
    render(Projects);

    const options = await screen.findByRole('button', { name: 'Options for Alpha' });
    expect(options.closest('a')).toBeNull();

    await fireEvent.click(options);

    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(router.path).toBe('/');
  });

  it('clicking a card navigates to its board', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [activeProject] }));
    render(Projects);

    await fireEvent.click(await screen.findByRole('link', { name: 'Alpha' }));

    expect(router.path).toBe('/projects/p-active');
    expect(router.current).toEqual({
      name: 'project',
      params: { id: 'p-active', view: 'board', filters: noFilters() },
    });
  });

  it('dims archived cards', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { projects: [activeProject, archivedProject] })
    );
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Archived (1)' }));

    const card = screen.getByRole('link', { name: 'Old prototype' }).closest('article')!;
    expect(card).toHaveClass('opacity-60');
    expect(within(card).getByText('0 open')).toBeInTheDocument();
    expect(within(card).getByText('0 done')).toBeInTheDocument();
  });

  it('shows empty states and opens the new project modal', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [] }));
    render(Projects);

    expect(await screen.findByText('No projects yet.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'New project' }));

    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('autocapitalize', 'sentences');
    expect(screen.getByRole('button', { name: 'Create project' })).toBeInTheDocument();
  });

  it('copies a project from the card menu', async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'POST') {
        const body = (await request.clone().json()) as { id: string; name: string };
        return jsonResponse(201, {
          project: {
            id: body.id,
            name: body.name,
            description: '',
            archived_at: null,
            created_by: me.id,
            member_ids: [],
            created_at: '2026-03-01T00:00:00.000Z',
          },
          columns: [],
          tasks: [],
          labels: [],
        });
      }
      return jsonResponse(200, { projects: [activeProject] });
    });
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Alpha' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));

    expect(screen.getByRole('heading', { name: 'Copy project' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Alpha copy');

    await fireEvent.click(screen.getByRole('button', { name: 'Copy project' }));

    expect(await screen.findByRole('link', { name: 'Alpha copy' })).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(
      (c) => (c[0] as Request).method === 'POST'
    )![0] as Request;
    expect(new URL(post.url).pathname).toBe('/api/projects');
    const body = (await post.clone().json()) as Record<string, unknown>;
    expect(body.source_project_id).toBe('p-active');
    expect(body.name).toBe('Alpha copy');
  });

  it('opens the delete confirmation from the card menu of a board you own', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [activeProject] }));
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Alpha' }));
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(screen.getByText(/This permanently removes the project/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeInTheDocument();
  });

  it('hides only Delete on a board created by someone else', async () => {
    const theirs = project({
      id: 'p-theirs',
      name: 'Ada Game',
      created_by: ada.id,
      member_ids: [me.id],
    });
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [theirs] }));
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Ada Game' }));

    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    for (const name of ['Rename', 'Copy', 'Share', 'Archive']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
    }
  });

  it('lists the owner and members in the members modal', async () => {
    users.users = [me, ada];
    const shared = project({
      id: 'p-shared',
      name: 'Team Game',
      created_by: me.id,
      member_ids: [ada.id],
    });
    mockApi(() => jsonResponse(200, { projects: [shared] }));

    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Team Game' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Share' }));

    expect(screen.getByText('Me (you)')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Ada' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Me' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Leave board' })).toBeNull();
  });

  it('adds a member by email from the members modal', async () => {
    users.users = [me];
    const added = { id: 'u-added', email: 'pat@example.com', name: 'Pat', avatar_url: null };
    const mine = project({ id: 'p-mine', name: 'Solo Game', created_by: me.id });
    mockApi((_request, url) =>
      url.pathname === '/api/projects/p-mine/members/by-email'
        ? jsonResponse(200, { status: 'member', role: 'editor', user: added, invitation: null })
        : jsonResponse(200, { projects: [mine] })
    );

    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Solo Game' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Share' }));

    await fireEvent.input(screen.getByLabelText('Add people'), {
      target: { value: 'pat@example.com' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Invite "pat@example.com"' }));

    expect(await screen.findByText('Pat')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(
      (c) => (c[0] as Request).method === 'POST'
    )![0] as Request;
    expect(await post.clone().json()).toEqual({ email: 'pat@example.com' });
  });

  it('removes a member by PUTting the reduced set', async () => {
    users.users = [me, ada];
    const shared = project({
      id: 'p-shared',
      name: 'Team Game',
      created_by: me.id,
      member_ids: [ada.id, 'u-3'],
    });
    mockApi((request) =>
      request.method === 'PUT' ? jsonResponse(204) : jsonResponse(200, { projects: [shared] })
    );

    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Team Game' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Share' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Ada' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as Request).method === 'PUT')).toBe(true);
    });
    const put = fetchMock.mock.calls.find((c) => (c[0] as Request).method === 'PUT')![0] as Request;
    expect(new URL(put.url).pathname).toBe('/api/projects/p-shared/members');
    expect(await put.clone().json()).toEqual({ user_ids: ['u-3'] });
    expect(screen.queryByRole('button', { name: 'Remove Ada' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Ada' })).toBeInTheDocument();
  });

  it('leaves a shared board by PUTting the set minus self', async () => {
    users.users = [me, ada];
    const shared = project({
      id: 'p-shared',
      name: 'Team Game',
      created_by: ada.id,
      member_ids: [me.id, 'u-3'],
    });
    mockApi((request) =>
      request.method === 'PUT' ? jsonResponse(204) : jsonResponse(200, { projects: [shared] })
    );

    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Team Game' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Share' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Leave board' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as Request).method === 'PUT')).toBe(true);
    });
    const put = fetchMock.mock.calls.find((c) => (c[0] as Request).method === 'PUT')![0] as Request;
    expect(new URL(put.url).pathname).toBe('/api/projects/p-shared/members');
    expect(await put.clone().json()).toEqual({ user_ids: ['u-3'] });
    expect(screen.queryByRole('link', { name: 'Team Game' })).toBeNull();
  });
});

describe('Projects card menu for a viewer', () => {
  it('keeps only the read-safe entries', async () => {
    const theirs = project({
      id: 'p-theirs',
      name: 'Ada Game',
      created_by: ada.id,
      member_ids: [me.id],
      members: [{ user_id: me.id, role: 'viewer' }],
    });
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [theirs] }));
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Ada Game' }));

    for (const name of ['Rename', 'Archive', 'Delete']) {
      expect(screen.queryByRole('menuitem', { name })).toBeNull();
    }
    for (const name of ['Copy', 'Share']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
    }
  });
});
