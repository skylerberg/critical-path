import { describe, expect, it } from 'vitest';
import { parseFilters } from './board-filters';
import { titleFor } from './route-title';
import type { Route } from './router.svelte';

const projectRoute = (params: Partial<Extract<Route, { name: 'project' }>['params']>): Route => ({
  name: 'project',
  params: { projectId: 'p1', view: 'board', filters: parseFilters(''), ...params },
});

describe('titleFor', () => {
  it('names the screen ahead of the app', () => {
    expect(titleFor({ name: 'my-tasks' })).toBe('My tasks · Critical Path');
    expect(titleFor({ name: 'account' })).toBe('Account · Critical Path');
  });

  it('carries the query so two searches are distinguishable in history', () => {
    expect(titleFor({ name: 'search', params: { q: 'ship' } })).toBe(
      'Search: ship · Critical Path'
    );
    expect(titleFor({ name: 'search', params: { q: '' } })).toBe('Search · Critical Path');
  });

  it('falls back to the app name while the project is still unknown', () => {
    expect(titleFor(projectRoute({}))).toBe('Critical Path');
  });

  it('distinguishes the two project views', () => {
    expect(titleFor(projectRoute({}), { projectName: 'Alpha' })).toBe('Alpha · Critical Path');
    expect(titleFor(projectRoute({ view: 'graph' }), { projectName: 'Alpha' })).toBe(
      'Alpha graph · Critical Path'
    );
  });

  // The overlay is a route, so the title has to move with it or every open card
  // reads as the board behind it.
  it('leads with the open task and keeps the project', () => {
    expect(
      titleFor(projectRoute({ taskId: 't1' }), { projectName: 'Alpha', taskTitle: 'Ship it' })
    ).toBe('Ship it — Alpha · Critical Path');
  });

  it('stays on the project when the open task has not resolved yet', () => {
    expect(titleFor(projectRoute({ taskId: 't1' }), { projectName: 'Alpha' })).toBe(
      'Alpha · Critical Path'
    );
  });
});
