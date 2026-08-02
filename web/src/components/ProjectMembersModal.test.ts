import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ProjectMembersModal from './ProjectMembersModal.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { router } from '../lib/router.svelte';
import { session } from '../lib/session.svelte';
import { projectHref, publicBoardHref } from '../lib/short-links';
import { testUuid } from '../lib/test-ids';
import { users } from '../lib/users.svelte';

const me = { id: 'u-me', email: 'me@example.com', name: 'Me', avatar_url: null };
const ada = { id: 'u-ada', email: 'ada@example.com', name: 'Ada', avatar_url: null };
const PROJECT_ID = testUuid('p-1');
const PROJECT_A = testUuid('p-A');
const PROJECT_B = testUuid('p-B');

function project(overrides: Partial<Project> = {}): Project {
  const memberIds = overrides.member_ids ?? [me.id];
  return {
    id: PROJECT_ID,
    name: 'Team Game',
    description: '',
    archived_at: null,
    created_by: ada.id,
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

beforeEach(() => {
  fetchMock.mockReset();
  projects.reset();
  users.reset();
  session.user = me;
  users.users = [me, ada];
  router.beforeNavigate = undefined;
  router.navigate('/', { replace: true });
});

describe('ProjectMembersModal', () => {
  it('marks the owner and offers no remove button for them or yourself', () => {
    projects.projects = [project()];

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });

    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Me (you)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Ada' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove Me/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Leave board' })).toBeInTheDocument();
  });

  it('hides the leave button for the creator', () => {
    projects.projects = [project({ created_by: me.id, member_ids: [ada.id] })];

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });

    expect(screen.queryByRole('button', { name: 'Leave board' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Ada' })).toBeInTheDocument();
  });

  it('offers the people picker pre-populated with your other collaborators', async () => {
    const bob = { id: 'u-bob', email: 'bob@example.com', name: 'Bob', avatar_url: null };
    users.users = [me, ada, bob];
    projects.projects = [project({ created_by: me.id, member_ids: [ada.id] })];
    fetchMock.mockImplementation(async () => jsonResponse(200, { users: [me, ada, bob] }));

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });

    expect(screen.getByLabelText('Add people')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Bob' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Ada' })).toBeNull();
    await waitFor(() => {
      expect(new URL((fetchMock.mock.calls[0]![0] as Request).url).pathname).toBe('/api/users');
    });
  });

  it('leaving from the board route PUTs minus self and navigates to the projects page', async () => {
    projects.projects = [project({ member_ids: [me.id, 'u-3'] })];
    fetchMock.mockImplementation(async () => jsonResponse(204));
    router.navigate(projectHref(PROJECT_ID, 'Team Game'));
    const onclose = vi.fn();

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose });

    await fireEvent.click(screen.getByRole('button', { name: 'Leave board' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as Request).method === 'PUT')).toBe(true);
    });
    const put = fetchMock.mock.calls.find((c) => (c[0] as Request).method === 'PUT')![0] as Request;
    expect(new URL(put.url).pathname).toBe(`/api/projects/${PROJECT_ID}/members`);
    expect(await put.clone().json()).toEqual({ user_ids: ['u-3'] });
    expect(projects.projects).toEqual([]);
    expect(onclose).toHaveBeenCalled();
    expect(router.path).toBe('/');
    expect(router.current.name).toBe('projects');
  });

  it('leaving from the projects page stays put', async () => {
    projects.projects = [project()];
    fetchMock.mockImplementation(async () => jsonResponse(204));

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });

    await fireEvent.click(screen.getByRole('button', { name: 'Leave board' }));

    expect(router.path).toBe('/');
    expect(router.current.name).toBe('projects');
    expect(projects.projects).toEqual([]);
  });

  it('offers "Make owner" only to the owner, and explains why they cannot leave', () => {
    projects.projects = [project({ created_by: me.id, member_ids: [ada.id] })];

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });

    expect(screen.getByRole('button', { name: 'Make owner: Ada' })).toBeInTheDocument();
    expect(
      screen.getByText("Owners can't leave a board. Make someone else the owner first.")
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leave board' })).toBeNull();
  });

  it('offers no "Make owner" button to an ordinary member', () => {
    projects.projects = [project()];

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });

    expect(screen.queryByRole('button', { name: /Make owner/ })).toBeNull();
  });

  it('confirms before transferring, and cancelling sends nothing', async () => {
    projects.projects = [project({ created_by: me.id, member_ids: [ada.id] })];

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });

    const makeOwner = screen.getByRole('button', { name: 'Make owner: Ada' });
    await fireEvent.click(makeOwner);

    expect(screen.getByText(/Make Ada the owner\?/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => (c[0] as Request).method === 'PUT')).toBe(false);

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/Make Ada the owner\?/)).toBeNull();
    expect(fetchMock.mock.calls.some((c) => (c[0] as Request).method === 'PUT')).toBe(false);
    expect(projects.projects[0]!.created_by).toBe(me.id);
    expect(document.activeElement).toBe(makeOwner);
  });

  it('focuses the confirmation so it is announced and scrolled into view', async () => {
    projects.projects = [project({ created_by: me.id, member_ids: [ada.id] })];

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });

    await fireEvent.click(screen.getByRole('button', { name: 'Make owner: Ada' }));

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('group', { name: /Make Ada the owner\?/ })
      );
    });
  });

  it('drops a pending transfer when that member is removed', async () => {
    projects.projects = [project({ created_by: me.id, member_ids: [ada.id] })];
    fetchMock.mockImplementation(async () => jsonResponse(204));

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });

    await fireEvent.click(screen.getByRole('button', { name: 'Make owner: Ada' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Ada' }));

    expect(screen.queryByText(/Make Ada the owner\?/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Transfer ownership' })).toBeNull();
    expect(projects.projects[0]!.created_by).toBe(me.id);
  });

  it('confirming PUTs the new owner and reveals the leave button', async () => {
    projects.projects = [project({ created_by: me.id, member_ids: [ada.id] })];
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'PUT') {
        return jsonResponse(200, {
          id: PROJECT_ID,
          name: 'Team Game',
          description: '',
          archived_at: null,
          created_at: '2026-01-01T00:00:00.000Z',
          created_by: ada.id,
          member_ids: [me.id],
        });
      }
      return jsonResponse(200, { users: [me, ada] });
    });

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });

    await fireEvent.click(screen.getByRole('button', { name: 'Make owner: Ada' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as Request).method === 'PUT')).toBe(true);
    });
    const put = fetchMock.mock.calls.find((c) => (c[0] as Request).method === 'PUT')![0] as Request;
    expect(new URL(put.url).pathname).toBe(`/api/projects/${PROJECT_ID}/owner`);
    expect(await put.clone().json()).toEqual({ user_id: ada.id });

    expect(projects.projects[0]!.created_by).toBe(ada.id);
    expect(projects.projects[0]!.member_ids).toEqual([me.id]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Leave board' })).toBeInTheDocument();
    });
    expect(
      screen.queryByText("Owners can't leave a board. Make someone else the owner first.")
    ).toBeNull();
  });
});

describe('ProjectMembersModal public link', () => {
  function patchRequests(): Request[] {
    return fetchMock.mock.calls
      .map((call) => call[0] as Request)
      .filter((request) => request.method === 'PATCH');
  }

  beforeEach(() => {
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'PATCH') {
        const body = (await request.clone().json()) as { is_public: boolean };
        const id = new URL(request.url).pathname.split('/').at(-1)!;
        return jsonResponse(200, { ...project({ id }), ...body });
      }
      return jsonResponse(200, { users: [me, ada] });
    });
  });

  it('offers publishing behind a confirm dialog that names what becomes visible', async () => {
    projects.projects = [project()];

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });

    expect(screen.queryByLabelText('Public link')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Publish read-only link' }));

    const dialog = screen.getByText(/Anyone with the link will be able to see/);
    expect(dialog).toHaveTextContent('every card title');
    expect(dialog).toHaveTextContent('every description');
    expect(dialog).toHaveTextContent('every image on those cards');
    expect(dialog).toHaveTextContent('who is assigned');
    expect(patchRequests()).toHaveLength(0);
  });

  it('confirming PATCHes is_public and then shows the copyable link', async () => {
    projects.projects = [project()];

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Publish read-only link' }));
    const confirm = screen
      .getAllByRole('button', { name: 'Publish read-only link' })
      .at(-1) as HTMLElement;
    await fireEvent.click(confirm);

    await waitFor(() => expect(patchRequests()).toHaveLength(1));
    const patch = patchRequests()[0]!;
    expect(new URL(patch.url).pathname).toBe(`/api/projects/${PROJECT_ID}`);
    expect(await patch.clone().json()).toEqual({ is_public: true });

    const field = await screen.findByLabelText('Public link');
    expect(field).toHaveValue(`${location.origin}${publicBoardHref(PROJECT_ID)}`);
  });

  it('copies the link to the clipboard', async () => {
    projects.projects = [project({ is_public: true })];
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith(`${location.origin}${publicBoardHref(PROJECT_ID)}`);
    vi.unstubAllGlobals();
  });

  it('stops sharing without a second confirm', async () => {
    projects.projects = [project({ is_public: true })];

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));

    await waitFor(() => expect(patchRequests()).toHaveLength(1));
    expect(await patchRequests()[0]!.clone().json()).toEqual({ is_public: false });
    await waitFor(() => expect(screen.queryByLabelText('Public link')).toBeNull());
  });

  it('targets the project it was given, not whichever board is open', async () => {
    projects.projects = [project({ id: PROJECT_A }), project({ id: PROJECT_B })];

    render(ProjectMembersModal, { projectId: PROJECT_B, onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Publish read-only link' }));
    await fireEvent.click(
      screen.getAllByRole('button', { name: 'Publish read-only link' }).at(-1) as HTMLElement
    );

    await waitFor(() => expect(patchRequests()).toHaveLength(1));
    expect(new URL(patchRequests()[0]!.url).pathname).toBe(`/api/projects/${PROJECT_B}`);
    expect(projects.projects.find((p) => p.id === PROJECT_A)?.is_public).toBe(false);
  });
});

describe('ProjectMembersModal roles', () => {
  const bob = { id: 'u-bob', email: 'bob@example.com', name: 'Bob', avatar_url: null };

  function roleSelect(name: string): HTMLSelectElement {
    return screen.getByLabelText(`Role for ${name}`) as HTMLSelectElement;
  }

  it('offers an editor a role control per other member and sends a roles-only body', async () => {
    users.users = [me, ada, bob];
    projects.projects = [
      project({
        created_by: me.id,
        member_ids: [ada.id, bob.id],
        members: [
          { user_id: ada.id, role: 'editor' },
          { user_id: bob.id, role: 'viewer' },
        ],
      }),
    ];
    fetchMock.mockImplementation(async () => jsonResponse(204));

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });

    expect(roleSelect('Ada').value).toBe('editor');
    expect(roleSelect('Bob').value).toBe('viewer');
    expect(roleSelect('Ada').className).toContain('min-h-11');

    await fireEvent.change(roleSelect('Ada'), { target: { value: 'viewer' } });

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as Request).method === 'PUT')).toBe(true);
    });
    const put = fetchMock.mock.calls.find((c) => (c[0] as Request).method === 'PUT')![0] as Request;
    expect(new URL(put.url).pathname).toBe(`/api/projects/${PROJECT_ID}/members`);
    expect(await put.clone().json()).toEqual({ roles: [{ user_id: ada.id, role: 'viewer' }] });
    expect(projects.projects[0]!.members).toEqual([
      { user_id: ada.id, role: 'viewer' },
      { user_id: bob.id, role: 'viewer' },
    ]);
  });

  it('gives a viewer no management controls but keeps the leave button', () => {
    users.users = [me, ada, bob];
    projects.projects = [
      project({
        created_by: ada.id,
        member_ids: [me.id, bob.id],
        members: [
          { user_id: me.id, role: 'viewer' },
          { user_id: bob.id, role: 'editor' },
        ],
      }),
    ];

    render(ProjectMembersModal, { projectId: PROJECT_ID, onclose: () => {} });

    expect(screen.queryByLabelText('Add people')).toBeNull();
    expect(screen.queryByLabelText(/^Role for /)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Make owner/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish read-only link' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Leave board' })).toBeInTheDocument();
    expect(screen.getByText('Viewer')).toBeInTheDocument();
  });
});
