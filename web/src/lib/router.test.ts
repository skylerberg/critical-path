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

  it('reads the unsubscribe token from the query string', () => {
    expect(matchRoute('/unsubscribe')).toEqual({ name: 'unsubscribe', params: {} });
    expect(matchRoute('/unsubscribe', '?token=abc%2F123')).toEqual({
      name: 'unsubscribe',
      params: { token: 'abc/123' },
    });
  });

  it('reads the invitation token from the query string', () => {
    expect(matchRoute('/invite')).toEqual({ name: 'invite', params: {} });
    expect(matchRoute('/invite', '?token=abc-123_x')).toEqual({
      name: 'invite',
      params: { token: 'abc-123_x' },
    });
  });

  it('reads the verify-email token from the query string', () => {
    expect(matchRoute('/verify-email')).toEqual({ name: 'verify-email', params: {} });
    expect(matchRoute('/verify-email', '?token=abc.def')).toEqual({
      name: 'verify-email',
      params: { token: 'abc.def' },
    });
    expect(matchRoute('/verify-email/')).toEqual({ name: 'verify-email', params: {} });
  });

  it('hands on an undecodable token instead of throwing', () => {
    expect(matchRoute('/verify-email', '?token=ab%zz')).toEqual({
      name: 'verify-email',
      params: { token: 'ab%zz' },
    });
    expect(matchRoute('/reset-password', '?token=50%')).toEqual({
      name: 'reset-password',
      params: { token: '50%' },
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

  it('percent-decodes a segment before reading it as an alias', () => {
    const escapeFirst = (alias: string): string =>
      `%${alias.charCodeAt(0).toString(16).padStart(2, '0')}${alias.slice(1)}`;
    expect(escapeFirst(P)).not.toBe(P);
    expect(matchRoute(`/p/${escapeFirst(P)}`)).toEqual({
      name: 'project',
      params: { projectId: PROJECT_ID, view: 'board', taskId: undefined, filters: noFilters() },
    });
    expect(matchRoute(`/t/${escapeFirst(T)}`)).toEqual({
      name: 'project',
      params: { projectId: null, view: 'board', taskId: TASK_ID, filters: noFilters() },
    });
  });

  it('returns not-found for malformed percent-encoding instead of throwing', () => {
    expect(matchRoute('/p/50%')).toEqual({ name: 'not-found', path: '/p/50%' });
    expect(matchRoute('/p/abc%zz')).toEqual({ name: 'not-found', path: '/p/abc%zz' });
  });

  it('rejects an alias that is not exactly 22 in-range characters', () => {
    for (const bad of [
      'zzz',
      P.slice(0, 21),
      `${P}A`,
      P.toLowerCase(),
      // Well-formed but past the largest uuid, and a dash-bearing alias from the
      // base64url scheme this replaced.
      'HxECNQWFdpvuJxIw3HPrmI',
      '9999999999999999999999',
      '-KGyw9TlT2qLnA0eLzpLXA',
    ]) {
      expect(matchRoute(`/p/${bad}`).name).toBe('not-found');
      expect(matchRoute(`/t/${bad}`).name).toBe('not-found');
      expect(matchRoute(`/p/${bad}/slug`).name).toBe('not-found');
      expect(matchRoute(`/public/projects/${bad}`).name).toBe('not-found');
    }
  });

  it('rejects a public task overlay whose task alias names no uuid', () => {
    expect(matchRoute(`/public/projects/${P}/tasks/HxECNQWFdpvuJxIw3HPrmI`).name).toBe('not-found');
  });

  // The complete set of paths the API sends people to, kept in step with
  // critical-path-api/src/services/webLinks.ts, where the same list is pinned
  // from the sending end. Neither repo can see the other, so each holds its own
  // half and both fail loudly; that is what /projects/:id lacked when the app
  // went alias-only and every assignment email started landing on not-found.
  //
  // A path removed here without being removed there is dead mail. Deleting a
  // case is a decision to stop honoring a link that is already in inboxes.
  it('routes every path the API puts in an email', () => {
    const emailed = [
      ['project', `/projects/${PROJECT_ID}`, ''],
      ['task', `/projects/${PROJECT_ID}/tasks/${TASK_ID}`, ''],
      ['invite', '/invite', '?token=abc'],
      ['verify-email', '/verify-email', '?token=abc'],
      ['unsubscribe', '/unsubscribe', '?token=abc'],
      ['password reset', '/reset-password', '?token=abc'],
    ] as const;

    const resolved = emailed.map(([label, path, search]) => [label, matchRoute(path, search).name]);
    expect(resolved).toEqual([
      ['project', 'project'],
      ['task', 'project'],
      ['invite', 'invite'],
      ['verify-email', 'verify-email'],
      ['unsubscribe', 'unsubscribe'],
      ['password reset', 'reset-password'],
    ]);
  });

  // The two shapes the API emails, and only those two. They resolve so the mail
  // is not dead; the board rewrites the address to the alias form once it loads,
  // so they never become a second canonical URL.
  it('resolves the uuid links the API sends in email', () => {
    const project = matchRoute(`/projects/${PROJECT_ID}`);
    expect(project.name).toBe('project');
    expect(project.name === 'project' && project.params.projectId).toBe(PROJECT_ID);
    expect(project.name === 'project' && project.params.taskId).toBeUndefined();

    const task = matchRoute(`/projects/${PROJECT_ID}/tasks/${TASK_ID}`);
    expect(task.name).toBe('project');
    expect(task.name === 'project' && task.params.projectId).toBe(PROJECT_ID);
    expect(task.name === 'project' && task.params.taskId).toBe(TASK_ID);
  });

  it('accepts a uuid only in the emailed shapes, never in an alias slot', () => {
    expect(matchRoute(`/p/${PROJECT_ID}`).name).toBe('not-found');
    expect(matchRoute(`/t/${TASK_ID}`).name).toBe('not-found');
    expect(matchRoute(`/public/projects/${PROJECT_ID}`).name).toBe('not-found');
    expect(matchRoute(`/projects/${PROJECT_ID}/graph`).name).toBe('not-found');
  });

  it('rejects a uuid-shaped segment that is not a uuid', () => {
    expect(matchRoute('/projects/not-a-uuid').name).toBe('not-found');
    expect(matchRoute(`/projects/${PROJECT_ID}x`).name).toBe('not-found');
    expect(matchRoute(`/projects/${PROJECT_ID}/tasks/nope`).name).toBe('not-found');
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

  // The Back button reaches #apply through the popstate listener, which is the
  // only thing that runs the guard on a pop: without it Back walks a signed-out
  // visitor onto the screen they were just bounced off.
  it('runs the auth guard on a popped history entry', () => {
    router.navigate('/login');
    router.beforeNavigate = (to) => (to.name === 'project' ? '/login' : undefined);
    try {
      window.history.pushState(null, '', projectHref(PROJECT_ID, 'Colorimetry'));
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(router.current).toEqual({ name: 'login' });
      expect(window.location.pathname).toBe('/login');
      expect(router.path).toBe('/login');
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

  function setup(href: string, attributes: Record<string, string> = {}): HTMLAnchorElement {
    const container = document.createElement('div');
    const anchor = document.createElement('a');
    anchor.setAttribute('href', href);
    for (const [name, value] of Object.entries(attributes)) {
      anchor.setAttribute(name, value);
    }
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

  // use:link goes on whole containers — both navs, the card menu, the projects
  // list — so every anchor inside one reaches this handler, including the ones
  // that were never in-app navigations: the card menu's "Open in new tab", an
  // export download, and any link off this origin.
  const passthrough: [string, string, Record<string, string>][] = [
    ['a new-tab link', '/account', { target: '_blank' }],
    ['a download link', '/account', { download: '' }],
    ['an anchor with no href', '', {}],
    ['a cross-origin link', 'https://example.com/account', {}],
  ];

  it.each(passthrough)('leaves %s to the browser', (_name, href, attributes) => {
    const anchor = setup(href, attributes);
    const pathBefore = router.path;
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    expect(dispatchClick(anchor, { button: 0 })).toBe(false);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(router.path).toBe(pathBefore);
  });

  // A click something nearer the anchor has already handled — a menu closing over
  // it, a drag ending on it — is not a navigation the router gets a second go at.
  it('leaves a click an inner handler already took', () => {
    const anchor = setup('/account');
    anchor.addEventListener('click', (event) => event.preventDefault());
    const pathBefore = router.path;
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    expect(dispatchClick(anchor, { button: 0 })).toBe(true);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(router.path).toBe(pathBefore);
  });

  // The control for the target case above: the attribute is read, not ignored.
  it('navigates in-app for an explicit target of _self', () => {
    const anchor = setup('/account', { target: '_self' });
    const pushState = vi.spyOn(window.history, 'pushState');
    expect(dispatchClick(anchor, { button: 0 })).toBe(true);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(router.path).toBe('/account');
  });
});
