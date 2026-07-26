import { afterEach, describe, expect, it, vi } from 'vitest';
import { noFilters } from './board-filters';
import { boardPath, link, matchRoute, router, splitPath } from './router.svelte';

describe('matchRoute', () => {
  it('matches the root path to projects', () => {
    expect(matchRoute('/')).toEqual({ name: 'projects' });
  });

  it('matches static routes', () => {
    expect(matchRoute('/login')).toEqual({ name: 'login' });
    expect(matchRoute('/signup')).toEqual({ name: 'signup' });
    expect(matchRoute('/account')).toEqual({ name: 'account' });
    expect(matchRoute('/forgot-password')).toEqual({ name: 'forgot-password' });
  });

  it('reads the reset-password token from the query string', () => {
    expect(matchRoute('/reset-password')).toEqual({ name: 'reset-password', params: {} });
    expect(matchRoute('/reset-password', '?token=abc123')).toEqual({
      name: 'reset-password',
      params: { token: 'abc123' },
    });
  });

  it('matches the project board view', () => {
    expect(matchRoute('/projects/abc-123')).toEqual({
      name: 'project',
      params: { id: 'abc-123', view: 'board', filters: noFilters() },
    });
  });

  it('matches the project graph view', () => {
    expect(matchRoute('/projects/p1/graph')).toEqual({
      name: 'project',
      params: { id: 'p1', view: 'graph', filters: noFilters() },
    });
  });

  it('matches a task overlay on the board view', () => {
    expect(matchRoute('/projects/p1/tasks/t9')).toEqual({
      name: 'project',
      params: { id: 'p1', view: 'board', taskId: 't9', filters: noFilters() },
    });
  });

  it('matches a task overlay on the graph view', () => {
    expect(matchRoute('/projects/p1/graph/tasks/t9')).toEqual({
      name: 'project',
      params: { id: 'p1', view: 'graph', taskId: 't9', filters: noFilters() },
    });
  });

  it('carries the parsed board filters on every project route', () => {
    expect(matchRoute('/projects/p1', '?labels=l1,l2&q=boss')).toEqual({
      name: 'project',
      params: {
        id: 'p1',
        view: 'board',
        filters: { labelIds: ['l1', 'l2'], assigneeIds: [], query: 'boss' },
      },
    });
    expect(matchRoute('/projects/p1/graph/tasks/t9', '?assignees=u1')).toEqual({
      name: 'project',
      params: {
        id: 'p1',
        view: 'graph',
        taskId: 't9',
        filters: { labelIds: [], assigneeIds: ['u1'], query: '' },
      },
    });
  });

  it('matches the public board and its task overlay', () => {
    expect(matchRoute('/public/projects/p1')).toEqual({
      name: 'public-board',
      params: { id: 'p1' },
    });
    expect(matchRoute('/public/projects/p1/tasks/t9')).toEqual({
      name: 'public-board',
      params: { id: 'p1', taskId: 't9' },
    });
    expect(matchRoute('/public/projects/p1/')).toEqual({
      name: 'public-board',
      params: { id: 'p1' },
    });
    expect(matchRoute('/public/projects')).toEqual({
      name: 'not-found',
      path: '/public/projects',
    });
  });

  it('decodes URI-encoded params', () => {
    expect(matchRoute('/projects/a%20b')).toEqual({
      name: 'project',
      params: { id: 'a b', view: 'board', filters: noFilters() },
    });
  });

  it('tolerates trailing slashes', () => {
    expect(matchRoute('/login/')).toEqual({ name: 'login' });
    expect(matchRoute('/projects/p1/')).toEqual({
      name: 'project',
      params: { id: 'p1', view: 'board', filters: noFilters() },
    });
  });

  it('returns not-found for malformed percent-encoding instead of throwing', () => {
    expect(matchRoute('/projects/50%')).toEqual({ name: 'not-found', path: '/projects/50%' });
    expect(matchRoute('/projects/abc%zz')).toEqual({
      name: 'not-found',
      path: '/projects/abc%zz',
    });
  });

  it('returns not-found for unknown paths', () => {
    expect(matchRoute('/nope')).toEqual({ name: 'not-found', path: '/nope' });
    expect(matchRoute('/projects/p1/tasks')).toEqual({
      name: 'not-found',
      path: '/projects/p1/tasks',
    });
    expect(matchRoute('/projects/p1/graph/tasks')).toEqual({
      name: 'not-found',
      path: '/projects/p1/graph/tasks',
    });
    expect(matchRoute('/projects/p1/graph/extra')).toEqual({
      name: 'not-found',
      path: '/projects/p1/graph/extra',
    });
  });
});

describe('router', () => {
  it('navigates with pushState and updates current', () => {
    router.navigate('/projects/p1');
    expect(window.location.pathname).toBe('/projects/p1');
    expect(router.current).toEqual({
      name: 'project',
      params: { id: 'p1', view: 'board', filters: noFilters() },
    });
    expect(router.path).toBe('/projects/p1');
  });

  it('parses the reset-password token when navigating with a query string', () => {
    router.navigate('/reset-password?token=xyz');
    expect(router.current).toEqual({ name: 'reset-password', params: { token: 'xyz' } });
    expect(router.path).toBe('/reset-password?token=xyz');
  });

  it('keeps a filter query string in the path and parses it into the route', () => {
    router.navigate('/projects/p1?labels=l1');
    expect(router.path).toBe('/projects/p1?labels=l1');
    expect(router.current).toEqual({
      name: 'project',
      params: { id: 'p1', view: 'board', filters: { ...noFilters(), labelIds: ['l1'] } },
    });
  });

  it('restores the filters of a popped history entry', () => {
    router.navigate('/projects/p1');
    window.history.pushState(null, '', '/projects/p1?q=x');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(router.path).toBe('/projects/p1?q=x');
    expect(router.current).toEqual({
      name: 'project',
      params: { id: 'p1', view: 'board', filters: { ...noFilters(), query: 'x' } },
    });
  });

  it('follows a beforeNavigate redirect', () => {
    router.beforeNavigate = (to) => {
      if (to.name === 'project') return '/login';
      return undefined;
    };
    try {
      router.navigate('/projects/p2');
      expect(router.current).toEqual({ name: 'login' });
      expect(window.location.pathname).toBe('/login');
    } finally {
      router.beforeNavigate = undefined;
    }
  });

  it('redirect replaces instead of pushing', () => {
    router.navigate('/signup');
    const lengthBefore = window.history.length;
    router.redirect('/login');
    expect(window.history.length).toBe(lengthBefore);
    expect(router.current).toEqual({ name: 'login' });
  });

  it('re-navigating to the current path does not push a history entry', () => {
    router.navigate('/projects/same');
    const lengthBefore = window.history.length;
    router.navigate('/projects/same');
    expect(window.history.length).toBe(lengthBefore);
    expect(router.current).toEqual({
      name: 'project',
      params: { id: 'same', view: 'board', filters: noFilters() },
    });
    expect(window.location.pathname).toBe('/projects/same');
  });

  it('a redirect resolving to the current path replaces instead of pushing', () => {
    router.navigate('/login');
    router.beforeNavigate = () => '/login';
    try {
      const lengthBefore = window.history.length;
      router.navigate('/projects/p9');
      expect(window.history.length).toBe(lengthBefore);
      expect(router.current).toEqual({ name: 'login' });
      expect(window.location.pathname).toBe('/login');
    } finally {
      router.beforeNavigate = undefined;
    }
  });
});

describe('boardPath', () => {
  it('round-trips through matchRoute for both modes', () => {
    expect(boardPath('p1', false)).toBe('/projects/p1');
    expect(boardPath('p1', true)).toBe('/public/projects/p1');
    expect(matchRoute(boardPath('p1', true)).name).toBe('public-board');
    expect(matchRoute(boardPath('p1', false)).name).toBe('project');
  });
});

describe('splitPath', () => {
  it('splits a path into pathname and search, dropping any hash', () => {
    expect(splitPath('/projects/p1')).toEqual({ pathname: '/projects/p1', search: '' });
    expect(splitPath('/projects/p1?q=x')).toEqual({ pathname: '/projects/p1', search: '?q=x' });
    expect(splitPath('/projects/p1?q=x#top')).toEqual({
      pathname: '/projects/p1',
      search: '?q=x',
    });
    expect(splitPath('/projects/p1#top')).toEqual({ pathname: '/projects/p1', search: '' });
  });
});

describe('link action', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.restoreAllMocks();
  });

  function setup(href: string): HTMLAnchorElement {
    const container = document.createElement('div');
    const anchor = document.createElement('a');
    anchor.setAttribute('href', href);
    anchor.textContent = 'go';
    container.appendChild(anchor);
    document.body.appendChild(container);
    const action = link(container);
    cleanup = () => {
      action?.destroy?.();
      container.remove();
    };
    return anchor;
  }

  // Fires after use:link (document is above the container), records whether
  // use:link prevented the click, then swallows it so jsdom never navigates.
  function dispatchClick(anchor: HTMLAnchorElement, init: MouseEventInit): boolean {
    let prevented = false;
    const observer = (event: Event): void => {
      prevented = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener('click', observer);
    try {
      anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    } finally {
      document.removeEventListener('click', observer);
    }
    return prevented;
  }

  it('handles plain left-clicks by navigating in-app', () => {
    const anchor = setup('/projects/link-target');
    const pushState = vi.spyOn(window.history, 'pushState');
    expect(dispatchClick(anchor, { button: 0 })).toBe(true);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(router.path).toBe('/projects/link-target');
  });

  it.each([
    ['shift', { shiftKey: true }],
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['alt', { altKey: true }],
    ['middle-click', { button: 1 }],
  ])('leaves %s clicks to the browser', (_name, init: MouseEventInit) => {
    const anchor = setup('/projects/modifier-target');
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    expect(dispatchClick(anchor, { button: 0, ...init })).toBe(false);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(router.path).not.toBe('/projects/modifier-target');
  });
});
