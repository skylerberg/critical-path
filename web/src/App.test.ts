import { fetchMock, jsonResponse } from './api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import App from './App.svelte';
import { board } from './lib/board.svelte';
import { myTasks } from './lib/myTasks.svelte';
import { projects } from './lib/projects.svelte';
import { realtime } from './lib/realtime.svelte';
import { router } from './lib/router.svelte';
import { session } from './lib/session.svelte';
import { shortcuts } from './lib/shortcuts.svelte';
import { users } from './lib/users.svelte';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(): void {}
  close(): void {}
}

vi.stubGlobal('WebSocket', FakeWebSocket);

const me = {
  id: 'u-me',
  email: 'me@example.com',
  name: 'Me',
  avatar_url: null,
  email_verified: false,
};

function publicBoard() {
  return {
    project: { id: 'p1', name: 'Roadmap', description: '' },
    columns: [{ id: 'todo', name: 'To Do', position: 1000, is_done: false }],
    tasks: [],
    labels: [],
    users: [],
  };
}

function routeResponses(): void {
  fetchMock.mockImplementation(async (input) => {
    const path = new URL((input as Request).url).pathname;
    if (path === '/api/auth/me') {
      return jsonResponse(200, me);
    }
    if (path === '/api/users') {
      return jsonResponse(200, { users: [me] });
    }
    if (path === '/api/projects') {
      return jsonResponse(200, { projects: [] });
    }
    if (path === '/api/my-tasks') {
      return jsonResponse(200, { tasks: [], waiting_on_you: [], you_are_waiting_on: [] });
    }
    if (path.startsWith('/api/public/projects/')) {
      return jsonResponse(200, publicBoard());
    }
    return jsonResponse(404, { error: `unexpected ${path}` });
  });
}

function navs(): HTMLElement[] {
  return screen.queryAllByRole('navigation', { name: 'Primary' });
}

beforeEach(() => {
  fetchMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  realtime.disconnect();
  board.reset();
  myTasks.reset();
  projects.reset();
  shortcuts.reset();
  users.reset();
  session.user = null;
  session.status = 'unknown';
  routeResponses();
});

describe('App chrome', () => {
  it('renders the public board with no signed-in navigation', async () => {
    router.navigate('/public/projects/p1', { replace: true });

    render(App);

    expect(await screen.findByText('Read-only')).toBeInTheDocument();
    expect(navs()).toEqual([]);
    expect(session.status).toBe('anon');
    expect(window.location.pathname).toBe('/public/projects/p1');
  });

  it('renders the navigation on an authenticated route', async () => {
    localStorage.setItem('cp.token', 'token');
    router.navigate('/', { replace: true });

    render(App);

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(navs().length).toBeGreaterThan(0);
  });

  // Verification state belongs on the account page and nowhere else; a
  // well-meaning banner added to the shell has to trip something.
  it('nags an unverified account nowhere in the shell', async () => {
    localStorage.setItem('cp.token', 'token');
    router.navigate('/', { replace: true });

    const { container } = render(App);

    await screen.findByRole('heading', { name: 'Projects' });
    expect(session.user?.email_verified).toBe(false);
    expect(container.textContent).not.toMatch(/verif/i);
  });

  it('renders the unsubscribe page to a signed-out visitor', async () => {
    router.navigate('/unsubscribe?token=t', { replace: true });
    fetchMock.mockResolvedValue(jsonResponse(200, { kind: 'task_assigned' }));

    render(App);

    expect(
      await screen.findByText("You'll no longer get email when someone assigns you a task.")
    ).toBeInTheDocument();
    expect(navs()).toEqual([]);
    expect(window.location.pathname).toBe('/unsubscribe');
  });

  it('renders my tasks on its own route', async () => {
    localStorage.setItem('cp.token', 'token');
    router.navigate('/my-tasks', { replace: true });

    render(App);

    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeInTheDocument();
  });

  it('leaves a signed-in route when another tab ends the session', async () => {
    localStorage.setItem('cp.token', 'token');
    router.navigate('/my-tasks', { replace: true });

    render(App);
    await screen.findByRole('heading', { name: 'My tasks' });

    localStorage.removeItem('cp.token');
    await session.init();

    await vi.waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(sessionStorage.getItem('cp.intendedPath')).toBe('/my-tasks');
  });

  it('runs the keymap off the project routes', async () => {
    localStorage.setItem('cp.token', 'token');
    router.navigate('/my-tasks', { replace: true });

    render(App);
    await screen.findByRole('heading', { name: 'My tasks' });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', cancelable: true }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Keyboard shortcuts' })
    ).toBeInTheDocument();
    expect(screen.getByText('Go to my tasks')).toBeInTheDocument();
  });

  it('routes the g m chord to my tasks from the projects list', async () => {
    localStorage.setItem('cp.token', 'token');
    router.navigate('/', { replace: true });

    render(App);
    await screen.findByRole('heading', { name: 'Projects' });

    for (const key of ['g', 'm']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
    }

    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/my-tasks');
  });
});
