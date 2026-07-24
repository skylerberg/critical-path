import '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Nav from './Nav.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { session } from '../lib/session.svelte';
import { router } from '../lib/router.svelte';

const me = { id: 'u-me', email: 'me@example.com', name: 'Me', avatar_url: null };

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
    ...overrides,
  };
}

beforeEach(() => {
  projects.reset();
  session.user = me;
  router.beforeNavigate = undefined;
  router.navigate('/', { replace: true });
});

describe('Nav sidebar', () => {
  it('lists active projects in one flat list with an active state', () => {
    projects.projects = [
      project({ id: 'p-solo', name: 'Solo Game' }),
      project({
        id: 'p-team',
        name: 'Team Game',
        member_ids: [me.id],
        created_at: '2026-01-02T00:00:00.000Z',
      }),
      project({ id: 'p-arch', name: 'Archived', archived_at: '2026-02-01T00:00:00.000Z' }),
    ];
    router.navigate('/projects/p-team');

    render(Nav);

    expect(screen.queryByText('Personal')).toBeNull();

    const solo = screen.getByRole('link', { name: 'Solo Game' });
    expect(solo).toHaveAttribute('href', '/projects/p-solo');
    const team = screen.getByRole('link', { name: 'Team Game' });
    expect(team).toHaveAttribute('href', '/projects/p-team');
    expect(team).toHaveAttribute('aria-current', 'page');

    expect(screen.queryByRole('link', { name: 'Archived' })).toBeNull();
  });

  it('links the user section to the account page', () => {
    render(Nav);

    const accountLinks = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/account');
    expect(accountLinks.length).toBeGreaterThan(0);
  });

  it('opens the feedback dialog from the sidebar footer', async () => {
    render(Nav);

    await fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(document.querySelector('dialog')?.open).toBe(true);
    expect(screen.getByLabelText('Feedback message')).toBeInTheDocument();
  });
});
