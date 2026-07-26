import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ProjectMembersModal from './ProjectMembersModal.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { router } from '../lib/router.svelte';
import { session } from '../lib/session.svelte';
import { users } from '../lib/users.svelte';

const me = { id: 'u-me', email: 'me@example.com', name: 'Me', avatar_url: null };
const ada = { id: 'u-ada', email: 'ada@example.com', name: 'Ada', avatar_url: null };

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    name: 'Team Game',
    description: '',
    archived_at: null,
    created_by: ada.id,
    member_ids: [me.id],
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

    render(ProjectMembersModal, { projectId: 'p-1', onclose: () => {} });

    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Me (you)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Ada' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove Me/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Leave board' })).toBeInTheDocument();
  });

  it('hides the leave button for the creator', () => {
    projects.projects = [project({ created_by: me.id, member_ids: [ada.id] })];

    render(ProjectMembersModal, { projectId: 'p-1', onclose: () => {} });

    expect(screen.queryByRole('button', { name: 'Leave board' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Ada' })).toBeInTheDocument();
  });

  it('offers the people picker pre-populated with your other collaborators', async () => {
    const bob = { id: 'u-bob', email: 'bob@example.com', name: 'Bob', avatar_url: null };
    users.users = [me, ada, bob];
    projects.projects = [project({ created_by: me.id, member_ids: [ada.id] })];
    fetchMock.mockImplementation(async () => jsonResponse(200, { users: [me, ada, bob] }));

    render(ProjectMembersModal, { projectId: 'p-1', onclose: () => {} });

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
    router.navigate('/projects/p-1');
    const onclose = vi.fn();

    render(ProjectMembersModal, { projectId: 'p-1', onclose });

    await fireEvent.click(screen.getByRole('button', { name: 'Leave board' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as Request).method === 'PUT')).toBe(true);
    });
    const put = fetchMock.mock.calls.find((c) => (c[0] as Request).method === 'PUT')![0] as Request;
    expect(new URL(put.url).pathname).toBe('/api/projects/p-1/members');
    expect(await put.clone().json()).toEqual({ user_ids: ['u-3'] });
    expect(projects.projects).toEqual([]);
    expect(onclose).toHaveBeenCalled();
    expect(router.path).toBe('/');
    expect(router.current.name).toBe('projects');
  });

  it('leaving from the projects page stays put', async () => {
    projects.projects = [project()];
    fetchMock.mockImplementation(async () => jsonResponse(204));

    render(ProjectMembersModal, { projectId: 'p-1', onclose: () => {} });

    await fireEvent.click(screen.getByRole('button', { name: 'Leave board' }));

    expect(router.path).toBe('/');
    expect(router.current.name).toBe('projects');
    expect(projects.projects).toEqual([]);
  });

  it('offers "Make owner" only to the owner, and explains why they cannot leave', () => {
    projects.projects = [project({ created_by: me.id, member_ids: [ada.id] })];

    render(ProjectMembersModal, { projectId: 'p-1', onclose: () => {} });

    expect(screen.getByRole('button', { name: 'Make owner: Ada' })).toBeInTheDocument();
    expect(
      screen.getByText("Owners can't leave a board. Make someone else the owner first.")
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leave board' })).toBeNull();
  });

  it('offers no "Make owner" button to an ordinary member', () => {
    projects.projects = [project()];

    render(ProjectMembersModal, { projectId: 'p-1', onclose: () => {} });

    expect(screen.queryByRole('button', { name: /Make owner/ })).toBeNull();
  });

  it('confirms before transferring, and cancelling sends nothing', async () => {
    projects.projects = [project({ created_by: me.id, member_ids: [ada.id] })];

    render(ProjectMembersModal, { projectId: 'p-1', onclose: () => {} });

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

    render(ProjectMembersModal, { projectId: 'p-1', onclose: () => {} });

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

    render(ProjectMembersModal, { projectId: 'p-1', onclose: () => {} });

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
          id: 'p-1',
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

    render(ProjectMembersModal, { projectId: 'p-1', onclose: () => {} });

    await fireEvent.click(screen.getByRole('button', { name: 'Make owner: Ada' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as Request).method === 'PUT')).toBe(true);
    });
    const put = fetchMock.mock.calls.find((c) => (c[0] as Request).method === 'PUT')![0] as Request;
    expect(new URL(put.url).pathname).toBe('/api/projects/p-1/owner');
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
