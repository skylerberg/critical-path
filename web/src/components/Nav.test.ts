import '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Nav from './Nav.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { workspaces, type Workspace } from '../lib/workspaces.svelte';
import { session } from '../lib/session.svelte';
import { router } from '../lib/router.svelte';

const me = { id: 'u-me', email: 'me@example.com', name: 'Me' };

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
  projects.reset();
  workspaces.reset();
  session.user = me;
  router.beforeNavigate = undefined;
  router.navigate('/', { replace: true });
});

describe('Nav sidebar', () => {
  it('lists accessible projects grouped by workspace with an active state', () => {
    projects.projects = [
      project({ id: 'p-solo', name: 'Solo Game' }),
      project({ id: 'p-team', name: 'Team Game', workspace_id: 'w-1' }),
      project({ id: 'p-tpl', name: 'Template', is_template: true }),
      project({ id: 'p-arch', name: 'Archived', archived_at: '2026-02-01T00:00:00.000Z' }),
    ];
    workspaces.workspaces = [workspace()];
    router.navigate('/projects/p-team');

    render(Nav);

    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getByText('Design Team')).toBeInTheDocument();

    const solo = screen.getByRole('link', { name: 'Solo Game' });
    expect(solo).toHaveAttribute('href', '/projects/p-solo');
    const team = screen.getByRole('link', { name: 'Team Game' });
    expect(team).toHaveAttribute('href', '/projects/p-team');
    expect(team).toHaveAttribute('aria-current', 'page');

    expect(screen.queryByRole('link', { name: 'Template' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Archived' })).toBeNull();
  });

  it('links the user section to the account page', () => {
    render(Nav);

    const accountLinks = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/account');
    expect(accountLinks.length).toBeGreaterThan(0);
  });
});
