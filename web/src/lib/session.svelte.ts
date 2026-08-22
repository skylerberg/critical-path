import { api, ApiError, assertOk, setAuthHooks } from '../api/client';
import type { components } from '../api/api.generated';
import { newId } from './ids';
import { clearMediaCaches } from './mediaCaches';
import { clearOfflineCache } from './offline-cache';
import { router, type Route } from './router.svelte';

export type SessionUser = components['schemas']['Me'];
// 'offline' is a signed-in session whose token could not be checked because the
// server was unreachable, not one that was turned down. Collapsing the two into
// 'anon' is what made launching without a network land on the login screen with
// every store reset — the blank-window failure, on a device that still holds a
// perfectly good token and a board.
export type SessionStatus = 'unknown' | 'authed' | 'offline' | 'anon';

// A session that survives a reload is signed in for routing purposes.
export function isSignedIn(status: SessionStatus): boolean {
  return status === 'authed' || status === 'offline';
}

const TOKEN_KEY = 'cp.token';
const USER_KEY = 'cp.user';
const INTENDED_PATH_KEY = 'cp.intendedPath';

const PUBLIC_ROUTES = new Set<Route['name']>([
  'login',
  'signup',
  'forgot-password',
  'reset-password',
]);

export function isPublicRoute(name: Route['name']): boolean {
  return PUBLIC_ROUTES.has(name);
}

// Distinct from PUBLIC_ROUTES, which means "signed-out only" and bounces an
// authed visitor away. These open for both.
const AUTH_OPTIONAL_ROUTES = new Set<Route['name']>([
  'public-board',
  'invite',
  'unsubscribe',
  'verify-email',
]);

export function isAuthOptionalRoute(name: Route['name']): boolean {
  return AUTH_OPTIONAL_ROUTES.has(name);
}

export function rememberIntendedPath(path: string): void {
  sessionStorage.setItem(INTENDED_PATH_KEY, path);
}

export function consumeIntendedPath(): string {
  const path = sessionStorage.getItem(INTENDED_PATH_KEY);
  sessionStorage.removeItem(INTENDED_PATH_KEY);
  return path ?? '/';
}

// Checked rather than cast: this is the one value the app trusts before it can
// reach the server, and everything keyed to the account — the board cache, the
// outbox — hangs off its id. A truncated or hand-edited entry reads as no entry.
function readStoredUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const candidate = parsed as Partial<SessionUser>;
    return typeof candidate.id === 'string' && typeof candidate.email === 'string'
      ? (candidate as SessionUser)
      : null;
  } catch {
    return null;
  }
}

class SessionStore {
  user = $state<SessionUser | null>(null);
  status = $state<SessionStatus>('unknown');
  #token: string | null = null;

  constructor() {
    setAuthHooks({
      getToken: () => this.#token,
      onUnauthorized: () => this.#handleUnauthorized(),
    });
  }

  get token(): string | null {
    return this.#token;
  }

  async init(): Promise<void> {
    this.status = 'unknown';
    this.#token = localStorage.getItem(TOKEN_KEY);
    if (this.#token === null) {
      this.#clear();
      return;
    }
    try {
      this.#setUser(assertOk(await api.GET('/api/auth/me')));
      this.status = 'authed';
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.#clear();
        return;
      }
      // The server was unreachable, which says nothing about the token. Carry on
      // with the account this device last saw so the cached board is reachable,
      // and let the first request that gets an answer settle it.
      const remembered = readStoredUser();
      if (remembered === null) {
        // Nothing to carry on as: a token stored before this cache existed.
        this.status = 'anon';
        this.user = null;
        return;
      }
      this.user = remembered;
      this.status = 'offline';
    }
  }

  // Narrower than init(): the session is already established, so re-reading the
  // account must not drop back through 'unknown' and blank the screen. A read
  // that lands also promotes an unvalidated 'offline' session — the server just
  // answered for this token, which is the proof init() could not get.
  async refresh(): Promise<void> {
    if (!isSignedIn(this.status)) {
      return;
    }
    const token = this.#token;
    const user = assertOk(await api.GET('/api/auth/me'));
    // A session cleared or replaced while this was in flight is the newer truth.
    if (this.#token !== token) {
      return;
    }
    this.#setUser(user);
    this.status = 'authed';
  }

  // Best-effort promotion for the callers that only want the side effect: a
  // rejected token is already handled by the client's 401 hook, and a still
  // unreachable server just leaves the session offline for the next attempt.
  async revalidate(): Promise<void> {
    if (this.status !== 'offline') {
      return;
    }
    try {
      await this.refresh();
    } catch {
      // Still unreachable, or no longer ours to refresh.
    }
  }

  async login(email: string, password: string): Promise<void> {
    const data = assertOk(await api.POST('/api/auth/login', { body: { email, password } }));
    this.#setSession(data.token, data.user);
  }

  async signup(name: string, email: string, password: string): Promise<void> {
    const data = assertOk(
      await api.POST('/api/auth/signup', { body: { id: newId(), name, email, password } })
    );
    this.#setSession(data.token, data.user);
  }

  async logout(): Promise<void> {
    try {
      await api.POST('/api/auth/logout');
    } catch {
      // Best effort: the local session is cleared regardless.
    }
    this.#clear();
    clearMediaCaches();
    sessionStorage.removeItem(INTENDED_PATH_KEY);
    if (router.current.name !== 'login') {
      router.navigate('/login');
    }
  }

  guardRoute = (to: Route, path: string): string | undefined => {
    if (isAuthOptionalRoute(to.name)) {
      return undefined;
    }
    const isPublic = isPublicRoute(to.name);
    if (isSignedIn(this.status) && isPublic) {
      return '/';
    }
    if (this.status === 'anon' && !isPublic) {
      rememberIntendedPath(path);
      return '/login';
    }
    return undefined;
  };

  // No logout call: for the flows that reach here the server has already
  // destroyed every session for this account, so there is nothing to log out of.
  forget(): void {
    this.#clear();
    sessionStorage.removeItem(INTENDED_PATH_KEY);
  }

  adopt(token: string, user: SessionUser): void {
    this.#setSession(token, user);
  }

  #setSession(token: string, user: SessionUser): void {
    this.#token = token;
    localStorage.setItem(TOKEN_KEY, token);
    this.#setUser(user);
    this.status = 'authed';
  }

  // Kept beside the token rather than in memory only: the copy exists so a load
  // that cannot reach the server still knows whose device this is, which a
  // reload would otherwise throw away along with everything keyed to it.
  #setUser(user: SessionUser): void {
    this.user = user;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  #clear(): void {
    const departing = this.user?.id;
    this.#token = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.user = null;
    this.status = 'anon';
    if (departing !== undefined) {
      // The cached board and anything still queued belong to the account that is
      // leaving. Left behind, the board would be readable by whoever signs in
      // next and the queue would replay one person's work as another's.
      void clearOfflineCache(departing).catch(() => {
        // Best effort, exactly as the media caches are: a storage layer that
        // refuses is not worth reporting to someone on their way out.
      });
    }
  }

  #handleUnauthorized(): void {
    if (this.status === 'anon') {
      return;
    }
    this.#clear();
    if (!isPublicRoute(router.current.name) && !isAuthOptionalRoute(router.current.name)) {
      rememberIntendedPath(router.path);
      router.redirect('/login');
    }
  }
}

export const session = new SessionStore();
