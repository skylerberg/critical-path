import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import Invite from './Invite.svelte';
import { projects } from '../lib/projects.svelte';
import { router } from '../lib/router.svelte';
import { session } from '../lib/session.svelte';
import { toasts } from '../lib/toasts.svelte';

function pathsCalled(): string[] {
  return fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
}

beforeEach(() => {
  fetchMock.mockReset();
  projects.reset();
  toasts.toasts = [];
  sessionStorage.clear();
  session.user = { id: 'u-me', email: 'me@example.com', name: 'Me', avatar_url: null };
  session.status = 'authed';
  router.beforeNavigate = undefined;
  router.navigate('/invite?token=tok-123', { replace: true });
});

describe('Invite', () => {
  it('redeems the link, reloads the boards, and lands on the one that was shared', async () => {
    fetchMock.mockImplementation(async (input) =>
      new URL((input as Request).url).pathname === '/api/invitations/accept'
        ? jsonResponse(200, { project_id: 'p-shared', role: 'editor' })
        : jsonResponse(200, { projects: [] })
    );

    render(Invite, { token: 'tok-123' });

    await waitFor(() => expect(router.path).toBe('/projects/p-shared'));
    const accept = fetchMock.mock.calls.find(
      (call) => new URL((call[0] as Request).url).pathname === '/api/invitations/accept'
    )![0] as Request;
    expect(accept.method).toBe('POST');
    expect(await accept.clone().json()).toEqual({ token: 'tok-123' });
    expect(pathsCalled()).toContain('/api/projects');
    expect(toasts.toasts.map((t) => t.message)).toContain('You joined the board');
  });

  it('sends a signed-out visitor to log in and brings them back to the link', async () => {
    session.user = null;
    session.status = 'anon';

    render(Invite, { token: 'tok-123' });

    await waitFor(() => expect(router.path).toBe('/login'));
    expect(sessionStorage.getItem('cp.intendedPath')).toBe('/invite?token=tok-123');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains a spent or withdrawn link rather than reporting a server error', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(422, { error: 'This invitation is no longer valid' })
    );

    render(Invite, { token: 'tok-123' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation link is no longer valid.'
    );
    expect(screen.getByRole('link', { name: 'Go to your boards' })).toBeInTheDocument();
    expect(router.path).toBe('/invite?token=tok-123');
  });

  it('treats a link with no token as dead without asking the server', async () => {
    render(Invite, { token: undefined });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation link is no longer valid.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an unreachable server distinctly from a dead link', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    render(Invite, { token: 'tok-123' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server. Check your connection and try again.'
    );
  });
});
