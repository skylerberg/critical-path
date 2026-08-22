import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import Invite from './Invite.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { router } from '../lib/router.svelte';
import { session } from '../lib/session.svelte';
import { projectHref } from '../lib/short-links';
import { testUuid } from '../lib/test-ids';
import { toasts } from '../lib/toasts.svelte';

const SHARED_ID = testUuid('p-shared');
const SHARED_NAME = 'Shared Board';

const sharedBoard: Project = {
  id: SHARED_ID,
  name: SHARED_NAME,
  description: '',
  archived_at: null,
  created_by: 'u-owner',
  member_ids: ['u-me'],
  members: [{ user_id: 'u-me', role: 'editor' }],
  is_public: false,
  color: null,
  created_at: '2026-01-01T00:00:00.000Z',
  open_task_count: 0,
  done_task_count: 0,
  sort_key: null,
  last_seen_at: null,
  has_unseen_changes: false,
};

function pathsCalled(): string[] {
  return fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
}

beforeEach(() => {
  fetchMock.mockReset();
  projects.reset();
  toasts.toasts = [];
  sessionStorage.clear();
  session.user = {
    id: 'u-me',
    email: 'me@example.com',
    name: 'Me',
    avatar_url: null,
    email_verified: false,
  };
  session.status = 'authed';
  router.beforeNavigate = undefined;
  router.navigate('/invite?token=tok-123', { replace: true });
});

describe('Invite', () => {
  it('redeems the link, reloads the boards, and lands on the one that was shared', async () => {
    fetchMock.mockImplementation(async (input) =>
      new URL((input as Request).url).pathname === '/api/invitations/accept'
        ? jsonResponse(200, { project_id: SHARED_ID, role: 'editor' })
        : jsonResponse(200, { projects: [sharedBoard] })
    );

    render(Invite, { token: 'tok-123' });

    await waitFor(() => expect(router.path).toBe(projectHref(SHARED_ID, SHARED_NAME)));
    const accept = fetchMock.mock.calls.find(
      (call) => new URL((call[0] as Request).url).pathname === '/api/invitations/accept'
    )![0] as Request;
    expect(accept.method).toBe('POST');
    expect(await accept.clone().json()).toEqual({ token: 'tok-123' });
    expect(pathsCalled()).toContain('/api/projects');
    expect(toasts.toasts.map((t) => t.message)).toContain('You have edit access to this board');
  });

  it('reports view-only access when the link leaves the caller a viewer', async () => {
    fetchMock.mockImplementation(async (input) =>
      new URL((input as Request).url).pathname === '/api/invitations/accept'
        ? jsonResponse(200, { project_id: SHARED_ID, role: 'viewer' })
        : jsonResponse(200, { projects: [sharedBoard] })
    );

    render(Invite, { token: 'tok-123' });

    await waitFor(() => expect(router.path).toBe(projectHref(SHARED_ID, SHARED_NAME)));
    expect(toasts.toasts.map((t) => t.message)).toEqual([
      'You have view-only access to this board',
    ]);
  });

  it('sends a signed-out visitor to log in and brings them back to the link', async () => {
    session.user = null;
    session.status = 'anon';

    render(Invite, { token: 'tok-123' });

    await waitFor(() => expect(router.path).toBe('/login'));
    expect(sessionStorage.getItem('cp.intendedPath')).toBe('/invite?token=tok-123');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A launch that could not reach /api/auth/me leaves a perfectly good session
  // unvalidated, and that is exactly the state a link opened from a mail client
  // on a phone arrives in.
  it('redeems for a session that could not be checked at launch', async () => {
    session.status = 'offline';
    fetchMock.mockImplementation(async (input) => {
      const path = new URL((input as Request).url).pathname;
      if (path === '/api/auth/me') {
        return jsonResponse(200, session.user);
      }
      return path === '/api/invitations/accept'
        ? jsonResponse(200, { project_id: SHARED_ID, role: 'editor' })
        : jsonResponse(200, { projects: [sharedBoard] });
    });

    render(Invite, { token: 'tok-123' });

    await waitFor(() => expect(router.path).toBe(projectHref(SHARED_ID, SHARED_NAME)));
    expect(session.status).toBe('authed');
    expect(pathsCalled()).toContain('/api/invitations/accept');
  });

  it('reports an unreachable server rather than dropping an unchecked session', async () => {
    session.status = 'offline';
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    render(Invite, { token: 'tok-123' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server. Check your connection and try again.'
    );
    expect(router.path).toBe('/invite?token=tok-123');
    expect(sessionStorage.getItem('cp.intendedPath')).toBeNull();
  });

  it('sends a visitor whose stored token has been revoked to log in', async () => {
    session.adopt('tok-revoked', session.user!);
    session.status = 'offline';
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    render(Invite, { token: 'tok-123' });

    await waitFor(() => expect(router.path).toBe('/login'));
    expect(sessionStorage.getItem('cp.intendedPath')).toBe('/invite?token=tok-123');
    expect(pathsCalled()).not.toContain('/api/invitations/accept');
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
