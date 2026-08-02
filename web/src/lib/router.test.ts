import { afterEach, describe, expect, it, vi } from 'vitest';
import { noFilters } from './board-filters';
import { link, matchRoute, router, splitPath } from './router.svelte';
import { encodeId, projectHref, publicBoardHref, publicTaskHref, taskHref } from './short-links';
import { testUuid } from './test-ids';

const PROJECT_ID = testUuid('p1');
const TASK_ID = testUuid('t9');
const P = encodeId(PROJECT_ID);
const T = encodeId(TASK_ID);

describe('matchRoute', () => {
  it('matches the root path to projects', () => {
    expect(matchRoute('/')).toEqual({ name: 'projects' });
  });

  it('matches static routes', () => {
    expect(matchRoute('/my-tasks')).toEqual({ name: 'my-tasks' });
    expect(matchRoute('/login')).toEqual({ name: 'login' });
    expect(matchRoute('/signup')).toEqual({ name: 'signup' });
    expect(matchRoute('/account')).toEqual({ name: 'account' });
    expect(matchRoute('/forgot-password')).toEqual({ name: 'forgot-password' });
  });

  it('reads the search query out of the query string', () => {
    expect(matchRoute('/search')).toEqual({ name: 'search', params: { q: '' } });
    expect(matchRoute('/search', '?q=export%20api')).toEqual({
      name: 'search',
      params: { q: 'export api' },
    });
    expect(matchRoute('/search', '?q=%20%20')).toEqual({ name: 'search', params: { q: '' } });
  });

  it('reads the reset-password token from the query string', () => {
    expect(matchRoute('/reset-password')).toEqual({ name: 'reset-password', params: {} });
    expect(matchRoute('/reset-password', '?token=abc123')).toEqual({
      name: 'reset-password',
      params: { token: 'abc123' },
    });
  });

  it('matches the project board view, with and without a slug', () => {
    const expected = {
      name: 'project',
      params: { projectId: PROJECT_ID, view: 'board', taskId: undefined, filters: noFilters() },
    };
    expect(matchRoute(`/p/${P}`)).toEqual(expected);
    expect(matchRoute(`/p/${P}/colorimetry`)).toEqual(expected);
  });

  it('matches the project graph view', () => {
    expect(matchRoute(`/p/${P}/colorimetry/graph`)).toEqual({
      name: 'project',
      params: { projectId: PROJECT_ID, view: 'graph', taskId: undefined, filters: noFilters() },
    });
  });

  it('matches a task overlay, naming no project until the task resolves', () => {
    const expected = {
      name: 'project',
      params: { projectId: null, view: 'board', taskId: TASK_ID, filters: noFilters() },
    };
    expect(matchRoute(`/t/${T}`)).toEqual(expected);
    expect(matchRoute(`/t/${T}/fix-the-login-bug`)).toEqual(expected);
  });

  it('matches a task overlay on the graph view', () => {
    expect(matchRoute(`/t/${T}/fix-the-login-bug/graph`)).toEqual({
      name: 'project',
      params: { projectId: null, view: 'graph', taskId: TASK_ID, filters: noFilters() },
    });
  });

  it('ignores the slug entirely, however wrong it is', () => {
    expect(matchRoute(`/t/${T}/a-totally-stale-title`)).toEqual(matchRoute(`/t/${T}/-`));
    expect(matchRoute(`/p/${P}/wrong`)).toEqual(matchRoute(`/p/${P}/also-wrong`));
  });

  // A grammar that reads segment 2 as an optional view keyword passes every other
  // routing test and fails only this one.
  it('treats segment two as the slug, so a project named Graph still opens its board', () => {
    expect(matchRoute(`/p/${P}/graph`)).toEqual({
      name: 'project',
      params: { projectId: PROJECT_ID, view: 'board', taskId: undefined, filters: noFilters() },
    });
    expect(matchRoute(`/p/${P}/graph/graph`)).toEqual({
      name: 'project',
      params: { projectId: PROJECT_ID, view: 'graph', taskId: undefined, filters: noFilters() },
    });
  });

  it('carries the parsed board filters on every project route', () => {
    expect(matchRoute(`/p/${P}/colorimetry`, '?labels=l1,l2&q=boss')).toEqual({
      name: 'project',
      params: {
        projectId: PROJECT_ID,
        view: 'board',
        taskId: undefined,
        filters: { labelIds: ['l1', 'l2'], assigneeIds: [], query: 'boss' },
      },
    });
    expect(matchRoute(`/t/${T}/fix/graph`, '?assignees=u1')).toEqual({
      name: 'project',
      params: {
        projectId: null,
        view: 'graph',
        taskId: TASK_ID,
        filters: { labelIds: [], assigneeIds: ['u1'], query: '' },
      },
    });
  });

  it('reads the my-tasks return path off a task overlay and nowhere else', () => {
    expect(matchRoute(`/t/${T}/fix`, '?from=my-tasks')).toEqual({
      name: 'project',
      params: {
        projectId: null,
        view: 'board',
        taskId: TASK_ID,
        filters: noFilters(),
        from: 'my-tasks',
      },
    });
    expect(matchRoute(`/t/${T}/fix/graph`, '?from=my-tasks')).toEqual({
      name: 'project',
      params: {
        projectId: null,
        view: 'graph',
        taskId: TASK_ID,
        filters: noFilters(),
        from: 'my-tasks',
      },
    });
    expect(matchRoute(`/t/${T}/fix`, '?from=elsewhere')).toEqual({
      name: 'project',
      params: { projectId: null, view: 'board', taskId: TASK_ID, filters: noFilters() },
    });
    expect(matchRoute(`/p/${P}/colorimetry`, '?from=my-tasks')).toEqual({
      name: 'project',
      params: { projectId: PROJECT_ID, view: 'board', taskId: undefined, filters: noFilters() },
    });
  });

  it('matches the public board and its task overlay', () => {
    expect(matchRoute(`/public/projects/${P}`)).toEqual({
      name: 'public-board',
      params: { id: PROJECT_ID },
    });
    expect(matchRoute(`/public/projects/${P}/tasks/${T}`)).toEqual({
      name: 'public-board',
      params: { id: PROJECT_ID, taskId: TASK_ID },
    });
    expect(matchRoute(`/public/projects/${P}/`)).toEqual({
      name: 'public-board',
      params: { id: PROJECT_ID },
    });
    expect(matchRoute('/public/projects')).toEqual({
      name: 'not-found',
      path: '/public/projects',
    });
  });

  it('tolerates trailing slashes', () => {
    expect(matchRoute('/login/')).toEqual({ name: 'login' });
    expect(matchRoute(`/p/${P}/colorimetry/`)).toEqual({
      name: 'project',
      params: { projectId: PROJECT_ID, view: 'board', taskId: undefined, filters: noFilters() },
    });
  });

  it('returns not-found for malformed percent-encoding instead of throwing', () => {
    expect(matchRoute('/p/50%')).toEqual({ name: 'not-found', path: '/p/50%' });
    expect(matchRoute('/p/abc%zz')).toEqual({ name: 'not-found', path: '/p/abc%zz' });
  });

  it('rejects an alias that is not exactly 22 canonical characters', () => {
    for (const bad of [
      'zzz',
      P.slice(0, 21),
      `${P}A`,
      P.toLowerCase(),
      `${P.slice(0, 21)}B`,
      `${P.slice(0, 21)}Z`,
    ]) {
      expect(matchRoute(`/p/${bad}`).name).toBe('not-found');
      expect(matchRoute(`/t/${bad}`).name).toBe('not-found');
      expect(matchRoute(`/p/${bad}/slug`).name).toBe('not-found');
      expect(matchRoute(`/public/projects/${bad}`).name).toBe('not-found');
    }
  });

  it('rejects a public task overlay whose task alias is non-canonical', () => {
    expect(matchRoute(`/public/projects/${P}/tasks/${T.slice(0, 21)}B`).name).toBe('not-found');
  });

  it('no longer accepts a raw uuid anywhere', () => {
    expect(matchRoute(`/projects/${PROJECT_ID}`).name).toBe('not-found');
    expect(matchRoute(`/projects/${PROJECT_ID}/graph`).name).toBe('not-found');
    expect(matchRoute(`/projects/${PROJECT_ID}/tasks/${TASK_ID}`).name).toBe('not-found');
    expect(matchRoute(`/public/projects/${PROJECT_ID}`).name).toBe('not-found');
    expect(matchRoute(`/p/${PROJECT_ID}`).name).toBe('not-found');
  });

  it('returns not-found for unknown paths', () => {
    expect(matchRoute('/nope')).toEqual({ name: 'not-found', path: '/nope' });
    expect(matchRoute(`/p/${P}/slug/extra`).name).toBe('not-found');
    expect(matchRoute(`/p/${P}/slug/graph/extra`).name).toBe('not-found');
    expect(matchRoute(`/t/${T}/slug/board`).name).toBe('not-found');
    expect(matchRoute(`/public/projects/${P}/tasks`).name).toBe('not-found');
  });
});

describe('router', () => {
  it('navigates with pushState and updates current', () => {
    router.navigate(`/p/${P}/colorimetry`);
    expect(window.location.pathname).toBe(`/p/${P}/colorimetry`);
    expect(router.current).toEqual({
      name: 'project',
      params: { projectId: PROJECT_ID, view: 'board', taskId: undefined, filters: noFilters() },
    });
    expect(router.path).toBe(`/p/${P}/colorimetry`);
  });

  it('parses the reset-password token when navigating with a query string', () => {
    router.navigate('/reset-password?token=xyz');
    expect(router.current).toEqual({ name: 'reset-password', params: { token: 'xyz' } });
    expect(router.path).toBe('/reset-password?token=xyz');
  });

  it('keeps a filter query string in the path and parses it into the route', () => {
    router.navigate(`/p/${P}/colorimetry?labels=l1`);
    expect(router.path).toBe(`/p/${P}/colorimetry?labels=l1`);
    expect(router.current).toEqual({
      name: 'project',
      params: {
        projectId: PROJECT_ID,
        view: 'board',
        taskId: undefined,
        filters: { ...noFilters(), labelIds: ['l1'] },
      },
    });
  });

  it('restores the filters of a popped history entry', () => {
    router.navigate(`/p/${P}/colorimetry`);
    window.history.pushState(null, '', `/p/${P}/colorimetry?q=x`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(router.path).toBe(`/p/${P}/colorimetry?q=x`);
    expect(router.current).toEqual({
      name: 'project',
      params: {
        projectId: PROJECT_ID,
        view: 'board',
        taskId: undefined,
        filters: { ...noFilters(), query: 'x' },
      },
    });
  });

  it('follows a beforeNavigate redirect', () => {
    router.beforeNavigate = (to) => {
      if (to.name === 'project') return '/login';
      return undefined;
    };
    try {
      router.navigate(`/p/${P}/colorimetry`);
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
    router.navigate(`/p/${P}/same`);
    const lengthBefore = window.history.length;
    router.navigate(`/p/${P}/same`);
    expect(window.history.length).toBe(lengthBefore);
    expect(router.current).toEqual({
      name: 'project',
      params: { projectId: PROJECT_ID, view: 'board', taskId: undefined, filters: noFilters() },
    });
    expect(window.location.pathname).toBe(`/p/${P}/same`);
  });

  it('a redirect resolving to the current path replaces instead of pushing', () => {
    router.navigate('/login');
    router.beforeNavigate = () => '/login';
    try {
      const lengthBefore = window.history.length;
      router.navigate(`/p/${P}/colorimetry`);
      expect(window.history.length).toBe(lengthBefore);
      expect(router.current).toEqual({ name: 'login' });
      expect(window.location.pathname).toBe('/login');
    } finally {
      router.beforeNavigate = undefined;
    }
  });
});

describe('href builders', () => {
  it('round-trip through matchRoute', () => {
    const board = matchRoute(projectHref(PROJECT_ID, 'Colorimetry'));
    expect(board).toMatchObject({ name: 'project', params: { projectId: PROJECT_ID } });
    const graph = matchRoute(projectHref(PROJECT_ID, 'Colorimetry', 'graph'));
    expect(graph).toMatchObject({ name: 'project', params: { view: 'graph' } });
    const task = matchRoute(taskHref(TASK_ID, 'Fix the login bug'));
    expect(task).toMatchObject({ name: 'project', params: { projectId: null, taskId: TASK_ID } });
    expect(matchRoute(publicBoardHref(PROJECT_ID))).toEqual({
      name: 'public-board',
      params: { id: PROJECT_ID },
    });
    expect(matchRoute(publicTaskHref(PROJECT_ID, TASK_ID))).toEqual({
      name: 'public-board',
      params: { id: PROJECT_ID, taskId: TASK_ID },
    });
  });

  it('round-trips a title that slugifies to nothing', () => {
    expect(matchRoute(projectHref(PROJECT_ID, '★★★'))).toMatchObject({
      name: 'project',
      params: { projectId: PROJECT_ID },
    });
  });
});

describe('splitPath', () => {
  it('splits a path into pathname and search, dropping any hash', () => {
    expect(splitPath('/p/abc')).toEqual({ pathname: '/p/abc', search: '' });
    expect(splitPath('/p/abc?q=x')).toEqual({ pathname: '/p/abc', search: '?q=x' });
    expect(splitPath('/p/abc?q=x#top')).toEqual({ pathname: '/p/abc', search: '?q=x' });
    expect(splitPath('/p/abc#top')).toEqual({ pathname: '/p/abc', search: '' });
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
    const anchor = setup('/my-tasks');
    const pushState = vi.spyOn(window.history, 'pushState');
    expect(dispatchClick(anchor, { button: 0 })).toBe(true);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(router.path).toBe('/my-tasks');
  });

  it.each([
    ['shift', { shiftKey: true }],
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['alt', { altKey: true }],
    ['middle-click', { button: 1 }],
  ])('leaves %s clicks to the browser', (_name, init: MouseEventInit) => {
    const anchor = setup('/account');
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    expect(dispatchClick(anchor, { button: 0, ...init })).toBe(false);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(router.path).not.toBe('/account');
  });
});
