import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Projects from './Projects.svelte';
import { invitations } from '../lib/invitations.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { noFilters } from '../lib/board-filters';
import { router } from '../lib/router.svelte';
import { session } from '../lib/session.svelte';
import { projectHref } from '../lib/short-links';
import { testUuid } from '../lib/test-ids';
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
    id: testUuid('p-1'),
    name: 'Alpha',
    description: '',
    archived_at: null,
    created_by: null,
    member_ids: memberIds,
    members: memberIds.map((user_id) => ({ user_id, role: 'editor' as const })),
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00.000Z',
    open_task_count: 0,
    done_task_count: 0,
    sort_key: null,
    last_seen_at: null,
    has_unseen_changes: false,
    ...overrides,
  };
}

const me = {
  id: 'u-me',
  email: 'me@example.com',
  name: 'Me',
  avatar_url: null,
  email_verified: false,
};
const ada = { id: 'u-ada', email: 'ada@example.com', name: 'Ada', avatar_url: null };

const ACTIVE_ID = testUuid('p-active');
const SHARED_ID = testUuid('p-shared');
const MINE_ID = testUuid('p-mine');

// The share modal loads the pending list for an editor, so tests that open it
// still need a well-formed answer for that one request.
function mockApi(handler: (request: Request, url: URL) => Response | Promise<Response>): void {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const url = new URL(request.url);
    return url.pathname.endsWith('/invitations')
      ? jsonResponse(200, { invitations: [] })
      : handler(request, url);
  });
}

const activeProject = project({
  id: ACTIVE_ID,
  name: 'Alpha',
  description: 'A deck-building game',
  created_by: me.id,
  open_task_count: 5,
  done_task_count: 3,
});
const archivedProject = project({
  id: testUuid('p-archived'),
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
      projectHref(ACTIVE_ID, 'Alpha')
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
      jsonResponse(200, { projects: [project({ id: testUuid('p-long'), name: longName })] })
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
        projects: [project({ id: testUuid('p-wordy'), description: longDescription })],
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
      jsonResponse(200, { projects: [project({ id: testUuid('p-plain'), name: 'Plain' })] })
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
    // The grid's parent, not a <main>: the shell owns the single main landmark now,
    // and each screen keeps its own page container as a plain wrapper.
    expect(card.parentElement?.parentElement).toHaveClass('max-w-7xl', 'gap-6');
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

    expect(router.path).toBe(projectHref(ACTIVE_ID, 'Alpha'));
    expect(router.current).toEqual({
      name: 'project',
      params: { projectId: ACTIVE_ID, view: 'board', filters: noFilters() },
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
    expect(body.source_project_id).toBe(ACTIVE_ID);
    expect(body.name).toBe('Alpha copy');
  });

  it('keeps the modal open with the typed name and the reason when create is rejected', async () => {
    mockApi((request) =>
      request.method === 'POST'
        ? jsonResponse(422, { error: 'Name must be 80 characters or fewer' })
        : jsonResponse(200, { projects: [activeProject] })
    );
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'A name too long' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('Name must be 80 characters or fewer')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New project' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('A name too long');
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled();
    expect(router.path).toBe('/');
  });

  it('rails a colored card and leaves an uncolored one bare', async () => {
    const colored = project({ id: testUuid('p-hue'), name: 'Hued', color: 'fuchsia' });
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { projects: [activeProject, colored] })
    );
    render(Projects);

    const railed = (await screen.findByRole('link', { name: 'Hued' })).closest('article')!;
    expect(railed).toHaveStyle({ boxShadow: 'inset 4px 0 0 var(--cp-project-fuchsia)' });
    expect(
      screen.getByRole('link', { name: 'Alpha' }).closest('article')!.getAttribute('style')
    ).toBeNull();
  });

  it('sets a color from the card menu and rails the card without a refetch', async () => {
    mockApi((request) =>
      request.method === 'PATCH'
        ? jsonResponse(200, { ...activeProject, color: 'lime' })
        : jsonResponse(200, { projects: [activeProject] })
    );
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Alpha' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Board color' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Lime' }));

    const patch = await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => (c[0] as Request).method === 'PATCH');
      expect(call).toBeDefined();
      return call![0] as Request;
    });
    expect(new URL(patch.url).pathname).toBe(`/api/projects/${ACTIVE_ID}`);
    expect(await patch.clone().json()).toEqual({ color: 'lime' });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Alpha' }).closest('article')).toHaveStyle({
        boxShadow: 'inset 4px 0 0 var(--cp-project-lime)',
      })
    );
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
      id: testUuid('p-theirs'),
      name: 'Ada Game',
      created_by: ada.id,
      member_ids: [me.id],
    });
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [theirs] }));
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Ada Game' }));

    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    for (const name of ['Rename', 'Board color', 'Copy', 'Share', 'Archive']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
    }
  });

  it('lists the owner and members in the members modal', async () => {
    users.users = [me, ada];
    const shared = project({
      id: SHARED_ID,
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
    const mine = project({ id: MINE_ID, name: 'Solo Game', created_by: me.id });
    mockApi((_request, url) =>
      url.pathname === `/api/projects/${MINE_ID}/members/by-email`
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
      id: SHARED_ID,
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
    expect(new URL(put.url).pathname).toBe(`/api/projects/${SHARED_ID}/members`);
    expect(await put.clone().json()).toEqual({ user_ids: ['u-3'] });
    expect(screen.queryByRole('button', { name: 'Remove Ada' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Ada' })).toBeInTheDocument();
  });

  it('leaves a shared board by PUTting the set minus self', async () => {
    users.users = [me, ada];
    const shared = project({
      id: SHARED_ID,
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
    expect(new URL(put.url).pathname).toBe(`/api/projects/${SHARED_ID}/members`);
    expect(await put.clone().json()).toEqual({ user_ids: ['u-3'] });
    expect(screen.queryByRole('link', { name: 'Team Game' })).toBeNull();
  });
});

describe('Projects card menu actions', () => {
  const secondProject = project({
    id: MINE_ID,
    name: 'Beta',
    created_by: me.id,
    created_at: '2026-01-02T00:00:00.000Z',
  });

  function patchRequests(): Request[] {
    return fetchMock.mock.calls
      .map((call) => call[0] as Request)
      .filter((request) => request.method === 'PATCH');
  }

  it('deletes the project the confirmation names and dismisses the dialog', async () => {
    mockApi((request) =>
      request.method === 'DELETE'
        ? jsonResponse(204)
        : jsonResponse(200, { projects: [activeProject, secondProject] })
    );
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Alpha' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));

    const deletes = fetchMock.mock.calls
      .map((call) => call[0] as Request)
      .filter((request) => request.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(new URL(deletes[0]!.url).pathname).toBe(`/api/projects/${ACTIVE_ID}`);
    expect(screen.queryByRole('link', { name: 'Alpha' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Delete project' })).toBeNull();
  });

  it('refuses a blank rename and sends a trimmed one', async () => {
    mockApi((request) =>
      request.method === 'PATCH'
        ? jsonResponse(200, { ...activeProject, name: 'Renamed' })
        : jsonResponse(200, { projects: [activeProject] })
    );
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Alpha' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: '   ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(patchRequests()).toHaveLength(0);

    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: '  Renamed  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchRequests()).toHaveLength(1));
    expect(new URL(patchRequests()[0]!.url).pathname).toBe(`/api/projects/${ACTIVE_ID}`);
    expect(await patchRequests()[0]!.clone().json()).toEqual({ name: 'Renamed' });
    expect(screen.queryByRole('heading', { name: 'Rename project' })).toBeNull();
    expect(await screen.findByRole('link', { name: 'Renamed' })).toBeInTheDocument();
  });

  it('archives an active board and unarchives an archived one', async () => {
    const mineArchived = project({
      id: testUuid('p-mine-archived'),
      name: 'Old prototype',
      created_by: me.id,
      archived_at: '2026-02-01T00:00:00.000Z',
      created_at: '2026-01-03T00:00:00.000Z',
    });
    mockApi(async (request) => {
      if (request.method !== 'PATCH') {
        return jsonResponse(200, { projects: [activeProject, mineArchived] });
      }
      const body = (await request.clone().json()) as { archived_at: string | null };
      const source = new URL(request.url).pathname.endsWith(ACTIVE_ID)
        ? activeProject
        : mineArchived;
      return jsonResponse(200, { ...source, archived_at: body.archived_at });
    });
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Alpha' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));

    await waitFor(() => expect(patchRequests()).toHaveLength(1));
    expect(new URL(patchRequests()[0]!.url).pathname).toBe(`/api/projects/${ACTIVE_ID}`);
    const archiving = (await patchRequests()[0]!.clone().json()) as { archived_at: unknown };
    expect(typeof archiving.archived_at).toBe('string');
    expect(await screen.findByRole('button', { name: 'Archived (2)' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Archived (2)' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Options for Old prototype' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Unarchive' }));

    await waitFor(() => expect(patchRequests()).toHaveLength(2));
    expect(new URL(patchRequests()[1]!.url).pathname).toBe(`/api/projects/${mineArchived.id}`);
    expect(await patchRequests()[1]!.clone().json()).toEqual({ archived_at: null });
  });

  // Focus has to land back on the kebab that opened the menu — the list renders
  // one per card, and the first on screen is not it.
  it('walks the menu with the arrow keys and hands focus back to the kebab that opened it', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { projects: [activeProject, secondProject] })
    );
    render(Projects);

    const trigger = await screen.findByRole('button', { name: 'Options for Beta' });
    await fireEvent.click(trigger);

    const menu = screen.getByRole('menu', { name: 'Options for Beta' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }));

    await fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Board color' }));

    await fireEvent.keyDown(menu, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  // Escape is how a card selection, a quick menu and a keyboard drag are all
  // cancelled, and the window handler here sees every one of them.
  it('leaves focus where it is when Escape arrives with no menu open', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [activeProject] }));
    render(Projects);

    const trigger = await screen.findByRole('button', { name: 'Options for Alpha' });
    await fireEvent.click(trigger);
    await fireEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    const cardLink = screen.getByRole('link', { name: 'Alpha' });
    cardLink.focus();
    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(document.activeElement).toBe(cardLink);
  });
});

describe('Projects when the list cannot be read', () => {
  it('reports the failure and reloads on Retry', async () => {
    let answer = jsonResponse(503, { error: 'Service unavailable' });
    fetchMock.mockImplementation(async () => answer.clone());
    render(Projects);

    expect(await screen.findByText('Service unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Alpha' })).toBeNull();

    answer = jsonResponse(200, { projects: [activeProject] });
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('link', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.queryByText('Service unavailable')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('Projects card menu for a viewer', () => {
  it('keeps only the read-safe entries', async () => {
    const theirs = project({
      id: testUuid('p-theirs'),
      name: 'Ada Game',
      created_by: ada.id,
      member_ids: [me.id],
      members: [{ user_id: me.id, role: 'viewer' }],
    });
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [theirs] }));
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Ada Game' }));

    for (const name of ['Rename', 'Board color', 'Archive', 'Delete']) {
      expect(screen.queryByRole('menuitem', { name })).toBeNull();
    }
    for (const name of ['Copy', 'Share']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
    }
  });
});

describe('Projects unseen changes dot', () => {
  it('marks a card with unseen changes and never an archived one', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        projects: [
          { ...activeProject, has_unseen_changes: true },
          { ...archivedProject, has_unseen_changes: true },
          project({ id: MINE_ID, name: 'Quiet', created_at: '2026-01-04T00:00:00.000Z' }),
        ],
      })
    );

    render(Projects);

    expect(await screen.findByRole('link', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quiet' })).toBeInTheDocument();
    expect(screen.getAllByText('Unseen changes')).toHaveLength(1);

    await fireEvent.click(screen.getByRole('button', { name: 'Archived (1)' }));

    expect(screen.getByRole('link', { name: 'Old prototype' })).toBeInTheDocument();
    expect(screen.getAllByText('Unseen changes')).toHaveLength(1);
  });
});
