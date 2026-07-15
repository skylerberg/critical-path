import { api, ApiError, assertOk, setAuthHooks } from '../api/client';
import type { components } from '../api/api.generated';
import { newId } from './ids';
import { router, type Route } from './router.svelte';

export type SessionUser = components['schemas']['User'];
export type SessionStatus = 'unknown' | 'authed' | 'anon';

const TOKEN_KEY = 'cp.token';
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

export function rememberIntendedPath(path: string): void {
  sessionStorage.setItem(INTENDED_PATH_KEY, path);
}

export function consumeIntendedPath(): string {
  const path = sessionStorage.getItem(INTENDED_PATH_KEY);
  sessionStorage.removeItem(INTENDED_PATH_KEY);
  return path ?? '/';
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
      this.user = assertOk(await api.GET('/api/auth/me'));
      this.status = 'authed';
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.#clear();
      } else {
        // Token kept in localStorage so a reload can retry validation.
        this.status = 'anon';
        this.user = null;
      }
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
    sessionStorage.removeItem(INTENDED_PATH_KEY);
    if (router.current.name !== 'login') {
      router.navigate('/login');
    }
  }

  guardRoute = (to: Route, path: string): string | undefined => {
    const isPublic = isPublicRoute(to.name);
    if (this.status === 'authed' && isPublic) {
      return '/';
    }
    if (this.status === 'anon' && !isPublic) {
      rememberIntendedPath(path);
      return '/login';
    }
    return undefined;
  };

  // No logout call: a password change/reset already revoked every session server-side.
  forget(): void {
    this.#clear();
    sessionStorage.removeItem(INTENDED_PATH_KEY);
  }

  #setSession(token: string, user: SessionUser): void {
    this.#token = token;
    localStorage.setItem(TOKEN_KEY, token);
    this.user = user;
    this.status = 'authed';
  }

  #clear(): void {
    this.#token = null;
    localStorage.removeItem(TOKEN_KEY);
    this.user = null;
    this.status = 'anon';
  }

  #handleUnauthorized(): void {
    if (this.status === 'anon') {
      return;
    }
    this.#clear();
    if (!isPublicRoute(router.current.name)) {
      rememberIntendedPath(router.path);
      router.redirect('/login');
    }
  }
}

export const session = new SessionStore();
