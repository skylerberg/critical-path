import { describe, expect, it } from 'vitest';
import { matchRoute, router } from './router.svelte';

describe('matchRoute', () => {
  it('matches the root path to projects', () => {
    expect(matchRoute('/')).toEqual({ name: 'projects' });
  });

  it('matches static routes', () => {
    expect(matchRoute('/login')).toEqual({ name: 'login' });
    expect(matchRoute('/signup')).toEqual({ name: 'signup' });
  });

  it('extracts the project id for the board', () => {
    expect(matchRoute('/projects/abc-123')).toEqual({
      name: 'board',
      params: { id: 'abc-123' },
    });
  });

  it('matches the graph view', () => {
    expect(matchRoute('/projects/p1/graph')).toEqual({
      name: 'graph',
      params: { id: 'p1' },
    });
  });

  it('extracts both params for the task detail route', () => {
    expect(matchRoute('/projects/p1/tasks/t9')).toEqual({
      name: 'task',
      params: { id: 'p1', taskId: 't9' },
    });
  });

  it('decodes URI-encoded params', () => {
    expect(matchRoute('/projects/a%20b')).toEqual({
      name: 'board',
      params: { id: 'a b' },
    });
  });

  it('tolerates trailing slashes', () => {
    expect(matchRoute('/login/')).toEqual({ name: 'login' });
    expect(matchRoute('/projects/p1/')).toEqual({ name: 'board', params: { id: 'p1' } });
  });

  it('returns not-found for unknown paths', () => {
    expect(matchRoute('/nope')).toEqual({ name: 'not-found', path: '/nope' });
    expect(matchRoute('/projects/p1/tasks')).toEqual({
      name: 'not-found',
      path: '/projects/p1/tasks',
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
    expect(router.current).toEqual({ name: 'board', params: { id: 'p1' } });
    expect(router.path).toBe('/projects/p1');
  });

  it('follows a beforeNavigate redirect', () => {
    router.beforeNavigate = (to) => {
      if (to.name === 'board') return '/login';
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
});
