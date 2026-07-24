import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { SOURCES, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
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
    position: null,
    ...overrides,
  };
}

function sidebarProjectNames(): string[] {
  return [...document.querySelectorAll('a[href^="/projects/"]')].map(
    (anchor) => anchor.textContent?.trim() ?? ''
  );
}

beforeEach(() => {
  fetchMock.mockReset();
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

  it('renders sidebar projects in position order with nulls last', async () => {
    projects.projects = [
      project({ id: 'p-legacy', name: 'Legacy', created_at: '2026-01-01T00:00:00.000Z' }),
      project({ id: 'p-2', name: 'Second', position: 2000 }),
      project({ id: 'p-1', name: 'First', position: 1000 }),
    ];

    render(Nav);

    await screen.findByRole('link', { name: 'First' });
    expect(sidebarProjectNames()).toEqual(['First', 'Second', 'Legacy']);
  });

  it('commits a drop by PUTting the computed midpoint position', async () => {
    projects.projects = [
      project({ id: 'p-a', name: 'A', position: 1000 }),
      project({ id: 'p-b', name: 'B', position: 2000 }),
      project({ id: 'p-c', name: 'C', position: 3000 }),
    ];
    fetchMock.mockImplementation(async () => jsonResponse(204));

    render(Nav);
    const linkA = await screen.findByRole('link', { name: 'A' });
    const zone = linkA.parentElement!.parentElement!;
    const [a, b, c] = projects.active;
    const detail: DndEvent<Project> = {
      items: [a!, c!, b!],
      info: { trigger: TRIGGERS.DROPPED_INTO_ZONE, id: 'p-c', source: SOURCES.POINTER },
    };
    await fireEvent(zone, new CustomEvent('finalize', { detail }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requestAt(0).method).toBe('PUT');
    expect(new URL(requestAt(0).url).pathname).toBe('/api/projects/p-c/position');
    expect(await requestAt(0).clone().json()).toEqual({ position: 1500 });
    await vi.waitFor(() => expect(sidebarProjectNames()).toEqual(['A', 'C', 'B']));
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
