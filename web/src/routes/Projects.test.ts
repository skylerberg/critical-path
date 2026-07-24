import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Projects from './Projects.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { session } from '../lib/session.svelte';
import { users } from '../lib/users.svelte';
import { workspaces, type Workspace } from '../lib/workspaces.svelte';

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
    is_template: false,
    archived_at: null,
    created_by: null,
    workspace_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    open_task_count: 0,
    done_task_count: 0,
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
const templateProject = project({
  id: 'p-template',
  name: 'Starter kit',
  is_template: true,
  created_at: '2026-01-02T00:00:00.000Z',
});
const archivedProject = project({
  id: 'p-archived',
  name: 'Old prototype',
  archived_at: '2026-02-01T00:00:00.000Z',
  created_at: '2026-01-03T00:00:00.000Z',
});

const me = { id: 'u-me', email: 'me@example.com', name: 'Me' };

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'w-1',
    name: 'Design Team',
    created_by: me.id,
    created_at: '2026-01-01T00:00:00.000Z',
    member_ids: [me.id],
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  projects.reset();
  workspaces.reset();
  users.reset();
  session.user = me;
});

describe('Projects', () => {
  it('renders cards with counts, a templates section, and a collapsed archived section', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { projects: [activeProject, templateProject, archivedProject] })
    );
    render(Projects);

    expect(await screen.findByRole('link', { name: 'Alpha' })).toHaveAttribute(
      'href',
      '/projects/p-active'
    );
    expect(screen.getByText('A deck-building game')).toBeInTheDocument();
    expect(screen.getByText('5 open')).toBeInTheDocument();
    expect(screen.getByText('3 done')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Starter kit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use template' })).toBeInTheDocument();

    expect(screen.queryByRole('link', { name: 'Old prototype' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Archived (1)' }));
    expect(screen.getByRole('link', { name: 'Old prototype' })).toBeInTheDocument();
  });

  it('shows empty states and opens the new project modal', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [] }));
    render(Projects);

    expect(await screen.findByText('No projects yet.')).toBeInTheDocument();
    expect(screen.getByText(/No templates yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'New project' }));

    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('autocapitalize', 'sentences');
    expect(screen.getByRole('button', { name: 'Create project' })).toBeInTheDocument();
  });

  it('prefills the name when using a template', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [templateProject] }));
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Use template' }));

    expect(screen.getByLabelText('Name')).toHaveValue('Starter kit copy');
  });

  it('opens the delete confirmation from the card menu', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [activeProject] }));
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Alpha' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(screen.getByText(/This permanently removes the project/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeInTheDocument();
  });

  it('groups projects under Personal and workspace headings', async () => {
    workspaces.workspaces = [workspace()];
    const personal = project({ id: 'p-personal', name: 'Solo Game' });
    const shared = project({ id: 'p-shared', name: 'Team Game', workspace_id: 'w-1' });
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [personal, shared] }));

    render(Projects);

    const personalHeading = await screen.findByRole('heading', { name: 'Personal' });
    const workspaceHeading = screen.getByRole('heading', { name: 'Design Team' });
    const personalSection = personalHeading.closest('section')!;
    const workspaceSection = workspaceHeading.closest('section')!;

    expect(within(personalSection).getByRole('link', { name: 'Solo Game' })).toBeInTheDocument();
    expect(within(personalSection).queryByRole('link', { name: 'Team Game' })).toBeNull();
    expect(within(workspaceSection).getByRole('link', { name: 'Team Game' })).toBeInTheDocument();
    expect(within(workspaceSection).getByRole('button', { name: /Members/ })).toBeInTheDocument();
  });

  it('creates a workspace from the New workspace button', async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'POST') {
        const body = (await request.clone().json()) as { id: string; name: string };
        return jsonResponse(201, workspace({ id: body.id, name: body.name }));
      }
      return jsonResponse(200, { projects: [] });
    });
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'New workspace' }));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Marketing' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Marketing' })).toBeInTheDocument();
    });
    const post = fetchMock.mock.calls.find(
      (c) => (c[0] as Request).method === 'POST'
    )![0] as Request;
    expect(new URL(post.url).pathname).toBe('/api/workspaces');
  });

  it('adds a member by email from the manage-members modal', async () => {
    workspaces.workspaces = [workspace()];
    users.users = [me];
    const added = { id: 'u-added', email: 'pat@example.com', name: 'Pat' };
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      const url = new URL(request.url);
      if (url.pathname === '/api/workspaces/w-1/members/by-email') {
        return jsonResponse(200, { user: added });
      }
      return jsonResponse(200, { projects: [] });
    });

    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: /Members/ }));
    expect(screen.getByText(/Me \(you\)/)).toBeInTheDocument();

    await fireEvent.input(screen.getByLabelText('Add by email'), {
      target: { value: 'pat@example.com' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Pat')).toBeInTheDocument();
  });

  it('moves a project to a workspace from the card menu', async () => {
    workspaces.workspaces = [workspace()];
    const personal = project({ id: 'p-move', name: 'Movable' });
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'PATCH') {
        return jsonResponse(200, { ...personal, workspace_id: 'w-1' });
      }
      return jsonResponse(200, { projects: [personal] });
    });

    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Movable' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Move to workspace ▸' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: /Design Team/ }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => (c[0] as Request).method === 'PATCH');
      expect(patch).toBeDefined();
    });
    const patch = fetchMock.mock.calls.find(
      (c) => (c[0] as Request).method === 'PATCH'
    )![0] as Request;
    expect(new URL(patch.url).pathname).toBe('/api/projects/p-move');
    expect(await patch.clone().json()).toEqual({ workspace_id: 'w-1' });
  });
});
