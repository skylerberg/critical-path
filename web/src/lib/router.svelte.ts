import type { Action } from 'svelte/action';

export type ProjectView = 'board' | 'graph';

export type Route =
  | { name: 'projects' }
  | { name: 'login' }
  | { name: 'signup' }
  | { name: 'account' }
  | { name: 'forgot-password' }
  | { name: 'reset-password'; params: { token?: string } }
  | { name: 'project'; params: { id: string; view: ProjectView; taskId?: string } }
  | { name: 'not-found'; path: string };

export type BeforeNavigate = (to: Route, path: string) => string | undefined | void;

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i]!;
    if (part.startsWith(':')) {
      try {
        params[part.slice(1)] = decodeURIComponent(pathParts[i]!);
      } catch {
        return null;
      }
    } else if (part !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export function matchRoute(pathname: string, search = ''): Route {
  const path = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/' || path === '') return { name: 'projects' };
  if (path === '/login') return { name: 'login' };
  if (path === '/signup') return { name: 'signup' };
  if (path === '/account') return { name: 'account' };
  if (path === '/forgot-password') return { name: 'forgot-password' };
  if (path === '/reset-password') {
    const match = /[?&]token=([^&]*)/.exec(search);
    const token = match ? decodeURIComponent(match[1]!) : null;
    return { name: 'reset-password', params: token === null ? {} : { token } };
  }
  let params = matchPattern('/projects/:id', path);
  if (params) return { name: 'project', params: { id: params.id!, view: 'board' } };
  params = matchPattern('/projects/:id/graph', path);
  if (params) return { name: 'project', params: { id: params.id!, view: 'graph' } };
  params = matchPattern('/projects/:id/tasks/:taskId', path);
  if (params) {
    return { name: 'project', params: { id: params.id!, view: 'board', taskId: params.taskId! } };
  }
  params = matchPattern('/projects/:id/graph/tasks/:taskId', path);
  if (params) {
    return { name: 'project', params: { id: params.id!, view: 'graph', taskId: params.taskId! } };
  }
  return { name: 'not-found', path: pathname };
}

const MAX_REDIRECTS = 10;

export class Router {
  current = $state.raw<Route>({ name: 'projects' });
  path = $state('/');
  beforeNavigate: BeforeNavigate | undefined;

  constructor() {
    if (typeof window !== 'undefined') {
      this.current = matchRoute(window.location.pathname, window.location.search);
      this.path = window.location.pathname + window.location.search + window.location.hash;
      window.addEventListener('popstate', () => {
        this.#apply(window.location.pathname + window.location.search + window.location.hash, {
          replace: true,
        });
      });
    }
  }

  navigate(path: string, options: { replace?: boolean } = {}): void {
    this.#apply(path, options);
  }

  redirect(path: string): void {
    this.navigate(path, { replace: true });
  }

  #apply(path: string, options: { replace?: boolean }): void {
    let target = path;
    let route = this.#parse(target);
    for (let i = 0; i < MAX_REDIRECTS; i++) {
      const redirected = this.beforeNavigate?.(route, target);
      if (typeof redirected !== 'string' || redirected === target) break;
      target = redirected;
      route = this.#parse(target);
    }
    const method = options.replace || target === this.path ? 'replaceState' : 'pushState';
    window.history[method](null, '', target);
    this.current = route;
    this.path = target;
  }

  #parse(path: string): Route {
    const withoutHash = path.split('#', 1)[0]!;
    const queryAt = withoutHash.indexOf('?');
    const pathname = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt);
    const search = queryAt === -1 ? '' : withoutHash.slice(queryAt);
    return matchRoute(pathname, search);
  }
}

export const router = new Router();

export const link: Action<HTMLElement> = (node) => {
  function onClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest('a');
    if (!anchor || !node.contains(anchor)) return;
    if (anchor.target !== '' && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;
    if (!anchor.getAttribute('href')) return;
    if (anchor.origin !== window.location.origin) return;
    event.preventDefault();
    router.navigate(anchor.pathname + anchor.search + anchor.hash);
  }

  node.addEventListener('click', onClick);
  return {
    destroy() {
      node.removeEventListener('click', onClick);
    },
  };
};
