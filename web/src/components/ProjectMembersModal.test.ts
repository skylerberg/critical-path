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

  it('shows an inline error for an unknown email', async () => {
    projects.projects = [project({ created_by: me.id, member_ids: [] })];
    fetchMock.mockImplementation(async () => jsonResponse(404, { error: 'not found' }));

    render(ProjectMembersModal, { projectId: 'p-1', onclose: () => {} });

    await fireEvent.input(screen.getByLabelText('Add by email'), {
      target: { value: 'ghost@example.com' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('No user with that email')).toBeInTheDocument();
  });

  it('leaving from the board route PUTs minus self and navigates to the projects page', async () => {
    projects.projects = [project({ member_ids: [me.id, 'u-3'] })];
    fetchMock.mockImplementation(async () => jsonResponse(204));
    router.navigate('/projects/p-1');
    const onclose = vi.fn();

    render(ProjectMembersModal, { projectId: 'p-1', onclose });

    await fireEvent.click(screen.getByRole('button', { name: 'Leave board' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const put = fetchMock.mock.calls[0]![0] as Request;
    expect(put.method).toBe('PUT');
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
});
