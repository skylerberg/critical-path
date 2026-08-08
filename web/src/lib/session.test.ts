import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import { consumeIntendedPath, rememberIntendedPath, session } from './session.svelte';
import { matchRoute, router } from './router.svelte';
import { projectHref, publicBoardHref } from './short-links';
import { testUuid } from './test-ids';

const user = {
  id: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
  email: 'ada@example.com',
  name: 'Ada',
  avatar_url: null,
  email_verified: false,
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROJECT_ID = testUuid('p1');
const BOARD_PATH = projectHref(PROJECT_ID, 'Game');
const PUBLIC_BOARD_PATH = publicBoardHref(PROJECT_ID);

async function loginAs(email = user.email): Promise<void> {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'tok-live', user }));
  await session.login(email, 'password123');
  fetchMock.mockClear();
}

beforeEach(async () => {
  fetchMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  router.beforeNavigate = undefined;
  router.navigate('/', { replace: true });
  await session.init();
  fetchMock.mockClear();
});

describe('intended path', () => {
  it('consumes the remembered path once', () => {
    rememberIntendedPath(BOARD_PATH);
    expect(consumeIntendedPath()).toBe(BOARD_PATH);
    expect(consumeIntendedPath()).toBe('/');
  });
});

describe('session.init', () => {
  it('resolves anon when no token is stored', async () => {
    await session.init();
    expect(session.status).toBe('anon');
    expect(session.user).toBeNull();
    expect(session.token).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates a stored token against /api/auth/me', async () => {
    localStorage.setItem('cp.token', 'tok-stored');
    fetchMock.mockResolvedValue(jsonResponse(200, user));

    await session.init();

    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/auth/me');
    expect(request.headers.get('authorization')).toBe('Bearer tok-stored');
    expect(session.status).toBe('authed');
    expect(session.user).toEqual(user);
  });

  it('clears the token and redirects to login on 401', async () => {
    router.navigate(BOARD_PATH);
    localStorage.setItem('cp.token', 'tok-expired');
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    await session.init();

    expect(session.status).toBe('anon');
    expect(localStorage.getItem('cp.token')).toBeNull();
    expect(window.location.pathname).toBe('/login');
    expect(consumeIntendedPath()).toBe(BOARD_PATH);
  });

  it('leaves a stale-token visitor on the public board instead of bouncing to login', async () => {
    router.navigate(PUBLIC_BOARD_PATH);
    localStorage.setItem('cp.token', 'tok-expired');
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    await session.init();

    expect(session.status).toBe('anon');
    expect(localStorage.getItem('cp.token')).toBeNull();
    expect(window.location.pathname).toBe(PUBLIC_BOARD_PATH);
    expect(consumeIntendedPath()).toBe('/');
  });

  it('keeps the token but resolves anon on network failure', async () => {
    localStorage.setItem('cp.token', 'tok-stored');
    fetchMock.mockRejectedValue(new TypeError('network down'));

    await session.init();

    expect(session.status).toBe('anon');
    expect(localStorage.getItem('cp.token')).toBe('tok-stored');
  });
});

describe('session.login', () => {
  it('stores the token and user on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { token: 'tok-new', user }));

    await session.login('ada@example.com', 'password123');

    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/auth/login');
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({ email: 'ada@example.com', password: 'password123' });
    expect(session.status).toBe('authed');
    expect(session.user).toEqual(user);
    expect(localStorage.getItem('cp.token')).toBe('tok-new');
  });

  it('surfaces an ApiError and stays anon on bad credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Invalid credentials' }));

    const failed = session.login('ada@example.com', 'wrong');

    await expect(failed).rejects.toBeInstanceOf(ApiError);
    await expect(failed).rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
    expect(session.status).toBe('anon');
    expect(localStorage.getItem('cp.token')).toBeNull();
  });
});

describe('session.refresh', () => {
  it('re-reads the account without passing through unknown', async () => {
    await loginAs();
    fetchMock.mockResolvedValue(jsonResponse(200, { ...user, name: 'Ada L' }));

    const refreshed = session.refresh();
    expect(session.status).toBe('authed');
    await refreshed;

    expect(new URL(requestAt(0).url).pathname).toBe('/api/auth/me');
    expect(session.user?.name).toBe('Ada L');
    expect(session.status).toBe('authed');
  });

  it('does nothing without a token', async () => {
    await session.refresh();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A token kept for a later retry is not a signed-in session: filling in the
  // account here would leave a user on screen the app believes is signed out.
  it('does nothing for a token init() never managed to validate', async () => {
    localStorage.setItem('cp.token', 'tok-unvalidated');
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: 'Service Unavailable' }));
    await session.init();
    expect(session.status).toBe('anon');
    expect(session.token).toBe('tok-unvalidated');

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, user));
    await session.refresh();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(session.user).toBeNull();
    expect(session.status).toBe('anon');
  });

  // Account deletion, password reset and a 401 all clear the session from under
  // an in-flight read; letting the late answer land would restore the account.
  it('discards a result for a session that ended while it was in flight', async () => {
    await loginAs();
    let release!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementationOnce(() => pending);

    const refreshing = session.refresh();
    session.forget();
    release(jsonResponse(200, { ...user, name: 'Stale Ada' }));
    await refreshing;

    expect(session.user).toBeNull();
    expect(session.status).toBe('anon');
    expect(session.token).toBeNull();
  });

  it('discards a result for a session replaced by a newer token', async () => {
    await loginAs();
    let release!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementationOnce(() => pending);

    const refreshing = session.refresh();
    session.adopt('tok-newer', { ...user, name: 'Fresh Ada' });
    release(jsonResponse(200, { ...user, name: 'Stale Ada' }));
    await refreshing;

    expect(session.user?.name).toBe('Fresh Ada');
  });
});

describe('session.signup', () => {
  it('sends a client-generated id and starts the session', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { token: 'tok-signup', user }));

    await session.signup('Ada', 'ada@example.com', 'password123');

    const body = (await requestAt(0).json()) as Record<string, unknown>;
    expect(new URL(requestAt(0).url).pathname).toBe('/api/auth/signup');
    expect(body.name).toBe('Ada');
    expect(body.email).toBe('ada@example.com');
    expect(body.password).toBe('password123');
    expect(body.id).toMatch(UUID_RE);
    expect(session.status).toBe('authed');
    expect(localStorage.getItem('cp.token')).toBe('tok-signup');
  });
});

describe('session.logout', () => {
  it('posts the logout, clears the session, and navigates to login', async () => {
    await loginAs();
    fetchMock.mockResolvedValue(jsonResponse(204));

    await session.logout();

    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/auth/logout');
    expect(request.headers.get('authorization')).toBe('Bearer tok-live');
    expect(session.status).toBe('anon');
    expect(session.user).toBeNull();
    expect(localStorage.getItem('cp.token')).toBeNull();
    expect(window.location.pathname).toBe('/login');
  });

  it('clears the local session even when the API call fails', async () => {
    await loginAs();
    fetchMock.mockRejectedValue(new TypeError('network down'));

    await session.logout();

    expect(session.status).toBe('anon');
    expect(localStorage.getItem('cp.token')).toBeNull();
    expect(window.location.pathname).toBe('/login');
  });

  // The image and avatar routes require a credential now, so the weeks of
  // board pictures the service worker holds must not outlive the session on a
  // shared machine.
  it('evicts the cached images and avatars', async () => {
    const cacheDelete = vi.fn<(name: string) => Promise<boolean>>().mockResolvedValue(true);
    // Assigned directly rather than through vi.stubGlobal: unstubbing restores
    // every global vitest is tracking, localStorage included, and this file
    // reaches for that in beforeEach.
    const scope = globalThis as { caches?: unknown };
    scope.caches = { delete: cacheDelete };
    try {
      await loginAs();
      fetchMock.mockResolvedValue(jsonResponse(204));

      await session.logout();

      expect(cacheDelete.mock.calls.map(([name]) => name)).toEqual(['api-images', 'api-avatars']);
    } finally {
      delete scope.caches;
    }
  });

  it('survives a browser with no CacheStorage at all', async () => {
    await loginAs();
    fetchMock.mockResolvedValue(jsonResponse(204));

    await expect(session.logout()).resolves.toBeUndefined();
    expect(session.status).toBe('anon');
  });
});

describe('401 on an authed call', () => {
  it('clears the session and redirects to login remembering the path', async () => {
    await loginAs();
    router.navigate(BOARD_PATH);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    await api.GET('/api/users');

    expect(session.status).toBe('anon');
    expect(localStorage.getItem('cp.token')).toBeNull();
    expect(window.location.pathname).toBe('/login');
    expect(consumeIntendedPath()).toBe(BOARD_PATH);
  });
});

describe('session.guardRoute', () => {
  it('redirects anon users to login and remembers the path', () => {
    expect(session.guardRoute(matchRoute(BOARD_PATH), BOARD_PATH)).toBe('/login');
    expect(consumeIntendedPath()).toBe(BOARD_PATH);
  });

  it('lets anon users reach every public route', () => {
    expect(session.guardRoute(matchRoute('/login'), '/login')).toBeUndefined();
    expect(session.guardRoute(matchRoute('/signup'), '/signup')).toBeUndefined();
    expect(session.guardRoute(matchRoute('/forgot-password'), '/forgot-password')).toBeUndefined();
    expect(
      session.guardRoute(matchRoute('/reset-password', '?token=t'), '/reset-password?token=t')
    ).toBeUndefined();
  });

  it('redirects anon users off the account page', () => {
    expect(session.guardRoute(matchRoute('/account'), '/account')).toBe('/login');
    expect(consumeIntendedPath()).toBe('/account');
  });

  it('redirects authed users away from every public route', async () => {
    await loginAs();
    expect(session.guardRoute(matchRoute('/login'), '/login')).toBe('/');
    expect(session.guardRoute(matchRoute('/signup'), '/signup')).toBe('/');
    expect(session.guardRoute(matchRoute('/forgot-password'), '/forgot-password')).toBe('/');
    expect(session.guardRoute(matchRoute('/reset-password'), '/reset-password')).toBe('/');
    expect(session.guardRoute(matchRoute('/account'), '/account')).toBeUndefined();
    expect(session.guardRoute(matchRoute(BOARD_PATH), BOARD_PATH)).toBeUndefined();
  });

  it('lets both anon and authed visitors reach the unsubscribe page', async () => {
    expect(
      session.guardRoute(matchRoute('/unsubscribe', '?token=t'), '/unsubscribe?token=t')
    ).toBeUndefined();
    await loginAs();
    expect(
      session.guardRoute(matchRoute('/unsubscribe', '?token=t'), '/unsubscribe?token=t')
    ).toBeUndefined();
  });

  it('lets both anon and authed visitors reach a public board', async () => {
    expect(session.guardRoute(matchRoute(PUBLIC_BOARD_PATH), PUBLIC_BOARD_PATH)).toBeUndefined();
    await loginAs();
    expect(session.guardRoute(matchRoute(PUBLIC_BOARD_PATH), PUBLIC_BOARD_PATH)).toBeUndefined();
    expect(consumeIntendedPath()).toBe('/');
  });

  // The usual click arrives from a mail client with no session; bouncing it
  // through sign-in first loses the token.
  it('lets both anon and authed visitors redeem a verification link', async () => {
    const path = '/verify-email?token=t';
    expect(session.guardRoute(matchRoute('/verify-email', '?token=t'), path)).toBeUndefined();
    await loginAs();
    expect(session.guardRoute(matchRoute('/verify-email', '?token=t'), path)).toBeUndefined();
    expect(consumeIntendedPath()).toBe('/');
  });

  it('does nothing while the session is unknown', () => {
    session.status = 'unknown';
    try {
      expect(session.guardRoute(matchRoute(BOARD_PATH), BOARD_PATH)).toBeUndefined();
    } finally {
      session.status = 'anon';
    }
  });
});

describe('a session that cannot be checked', () => {
  // Collapsing "unreachable" into "signed out" is what made launching without a
  // network land on the login screen and reset every store, on a device holding
  // a perfectly good token.
  it('stays signed in as the remembered account when the server cannot be reached', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'tok-live', user }));
    await session.login(user.email, 'password123');

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await session.init();

    expect(session.status).toBe('offline');
    expect(session.user).toEqual(user);
    expect(session.token).toBe('tok-live');
  });

  it('admits an offline session to the app instead of bouncing it to login', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'tok-live', user }));
    await session.login(user.email, 'password123');
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await session.init();

    expect(session.status).toBe('offline');
    expect(session.guardRoute(matchRoute(BOARD_PATH), BOARD_PATH)).toBeUndefined();
    // And still bounces away from the signed-out-only routes.
    expect(session.guardRoute(matchRoute('/login'), '/login')).toBe('/');
  });

  it('still signs out when the server is reachable and rejects the token', async () => {
    localStorage.setItem('cp.token', 'tok-revoked');
    localStorage.setItem('cp.user', JSON.stringify(user));
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    await session.init();

    expect(session.status).toBe('anon');
    expect(session.user).toBeNull();
    expect(localStorage.getItem('cp.user')).toBeNull();
  });

  // A token stored by a build that predates the cached account has nothing to
  // carry on as, and guessing would be worse than the old behaviour.
  it('falls back to signed out when there is no remembered account', async () => {
    localStorage.setItem('cp.token', 'tok-stored');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await session.init();

    expect(session.status).toBe('anon');
  });

  it('promotes to a checked session once a read gets through', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'tok-live', user }));
    await session.login(user.email, 'password123');
    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await session.init();
    expect(session.status).toBe('offline');

    fetchMock.mockResolvedValue(jsonResponse(200, user));
    await session.revalidate();

    expect(session.status).toBe('authed');
  });
});
