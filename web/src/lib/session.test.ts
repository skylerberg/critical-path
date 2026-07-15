import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, ApiError } from '../api/client';
import { consumeIntendedPath, rememberIntendedPath, session } from './session.svelte';
import { matchRoute, router } from './router.svelte';

const user = { id: 'a3bb189e-8bf9-3888-9912-ace4e6543002', email: 'ada@example.com', name: 'Ada' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
    rememberIntendedPath('/projects/p1');
    expect(consumeIntendedPath()).toBe('/projects/p1');
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
    router.navigate('/projects/p1');
    localStorage.setItem('cp.token', 'tok-expired');
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    await session.init();

    expect(session.status).toBe('anon');
    expect(localStorage.getItem('cp.token')).toBeNull();
    expect(window.location.pathname).toBe('/login');
    expect(consumeIntendedPath()).toBe('/projects/p1');
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
});

describe('401 on an authed call', () => {
  it('clears the session and redirects to login remembering the path', async () => {
    await loginAs();
    router.navigate('/projects/p1');
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    await api.GET('/api/users');

    expect(session.status).toBe('anon');
    expect(localStorage.getItem('cp.token')).toBeNull();
    expect(window.location.pathname).toBe('/login');
    expect(consumeIntendedPath()).toBe('/projects/p1');
  });
});

describe('session.guardRoute', () => {
  it('redirects anon users to login and remembers the path', () => {
    expect(session.guardRoute(matchRoute('/projects/p1'), '/projects/p1')).toBe('/login');
    expect(consumeIntendedPath()).toBe('/projects/p1');
  });

  it('lets anon users reach login and signup', () => {
    expect(session.guardRoute(matchRoute('/login'), '/login')).toBeUndefined();
    expect(session.guardRoute(matchRoute('/signup'), '/signup')).toBeUndefined();
  });

  it('redirects authed users away from login and signup', async () => {
    await loginAs();
    expect(session.guardRoute(matchRoute('/login'), '/login')).toBe('/');
    expect(session.guardRoute(matchRoute('/signup'), '/signup')).toBe('/');
    expect(session.guardRoute(matchRoute('/projects/p1'), '/projects/p1')).toBeUndefined();
  });

  it('does nothing while the session is unknown', () => {
    session.status = 'unknown';
    try {
      expect(session.guardRoute(matchRoute('/projects/p1'), '/projects/p1')).toBeUndefined();
    } finally {
      session.status = 'anon';
    }
  });
});
