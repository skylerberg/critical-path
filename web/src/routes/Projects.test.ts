import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Projects from './Projects.svelte';
import { projects, type Project } from '../lib/projects.svelte';
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
  return {
    id: 'p-1',
    name: 'Alpha',
    description: '',
    archived_at: null,
    created_by: null,
    member_ids: [],
    created_at: '2026-01-01T00:00:00.000Z',
    open_task_count: 0,
    done_task_count: 0,
    position: null,
    ...overrides,
  };
}

const activeProject = project({
  id: 'p-active',
  name: 'Alpha',
  description: 'A deck-building game',
  open_task_count: 5,
  done_task_count: 3,
});
const archivedProject = project({
  id: 'p-archived',
  name: 'Old prototype',
  archived_at: '2026-02-01T00:00:00.000Z',
  created_at: '2026-01-03T00:00:00.000Z',
});

const me = { id: 'u-me', email: 'me@example.com', name: 'Me', avatar_url: null };
const ada = { id: 'u-ada', email: 'ada@example.com', name: 'Ada', avatar_url: null };

beforeEach(() => {
  fetchMock.mockReset();
  projects.reset();
  users.reset();
  session.user = me;
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

  it('opens the delete confirmation from the card menu', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [activeProject] }));
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Alpha' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(screen.getByText(/This permanently removes the project/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeInTheDocument();
  });

  it('lists the owner and members in the members modal', async () => {
    users.users = [me, ada];
    const shared = project({
      id: 'p-shared',
      name: 'Team Game',
      created_by: me.id,
      member_ids: [ada.id],
    });
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [shared] }));

    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Team Game' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Members' }));

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
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      const url = new URL(request.url);
      if (url.pathname === '/api/projects/p-mine/members/by-email') {
        return jsonResponse(200, { user: added });
      }
      return jsonResponse(200, { projects: [mine] });
    });

    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Solo Game' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Members' }));

    await fireEvent.input(screen.getByLabelText('Add by email'), {
      target: { value: 'pat@example.com' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));

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
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'PUT') {
        return jsonResponse(204);
      }
      return jsonResponse(200, { projects: [shared] });
    });

    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Team Game' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Members' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Ada' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as Request).method === 'PUT')).toBe(true);
    });
    const put = fetchMock.mock.calls.find((c) => (c[0] as Request).method === 'PUT')![0] as Request;
    expect(new URL(put.url).pathname).toBe('/api/projects/p-shared/members');
    expect(await put.clone().json()).toEqual({ user_ids: ['u-3'] });
    expect(screen.queryByText('Ada')).toBeNull();
  });

  it('leaves a shared board by PUTting the set minus self', async () => {
    users.users = [me, ada];
    const shared = project({
      id: 'p-shared',
      name: 'Team Game',
      created_by: ada.id,
      member_ids: [me.id, 'u-3'],
    });
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'PUT') {
        return jsonResponse(204);
      }
      return jsonResponse(200, { projects: [shared] });
    });

    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Team Game' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Members' }));
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
