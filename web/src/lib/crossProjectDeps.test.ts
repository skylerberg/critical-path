import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crossProjectDeps, type CrossProjectDependencies } from './crossProjectDeps.svelte';
import { taskRoute } from './task-route.svelte';
import { toasts } from './toasts.svelte';

function deps(overrides: Partial<CrossProjectDependencies> = {}): CrossProjectDependencies {
  return {
    blocked_by: [],
    blocking: [],
    hidden_blocked_by_count: 0,
    hidden_blocking_count: 0,
    ...overrides,
  };
}

const remote = {
  task_id: 'far-1',
  project_id: 'p-far',
  project_name: 'Design',
  title: 'Sign off',
  is_done: false,
};

function respondWith(body: CrossProjectDependencies): void {
  fetchMock.mockImplementation(async () => jsonResponse(200, body));
}

async function settle(): Promise<void> {
  await vi.waitFor(() => expect(crossProjectDeps.get('t1')?.loading).toBe(false));
}

beforeEach(() => {
  fetchMock.mockReset();
  crossProjectDeps.reset();
  taskRoute.reset();
  respondWith(deps());
});

describe('crossProjectDeps store', () => {
  it('fetches once and serves the cache after', async () => {
    crossProjectDeps.ensure('t1');
    await settle();

    expect(new URL(requestAt(0).url).pathname).toBe('/api/tasks/t1/cross-project-dependencies');
    expect(crossProjectDeps.get('t1')?.deps).toEqual(deps());

    crossProjectDeps.ensure('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refresh always refetches and keeps the cached rows painted meanwhile', async () => {
    respondWith(deps({ blocked_by: [remote] }));
    crossProjectDeps.ensure('t1');
    await settle();

    crossProjectDeps.refresh('t1');
    // Still showing what it had, rather than dropping to skeletons.
    expect(crossProjectDeps.get('t1')?.deps?.blocked_by).toEqual([remote]);
    expect(crossProjectDeps.get('t1')?.loading).toBe(true);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidate does nothing for a task nobody is watching', () => {
    crossProjectDeps.invalidate('never-opened');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('seeds the task route with every readable edge it names', async () => {
    respondWith(deps({ blocked_by: [remote] }));
    crossProjectDeps.ensure('t1');
    await settle();

    // Resolves without a lookup, which is what makes the row click instant.
    expect(taskRoute.locate({ projectId: null, taskId: 'far-1' })).toEqual({
      status: 'ready',
      projectId: 'p-far',
    });
  });

  it('treats a 404 as an empty list, not an error', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(404, { error: 'Task not found' }));
    crossProjectDeps.ensure('t1');
    await settle();

    expect(crossProjectDeps.get('t1')).toEqual({ deps: deps(), loading: false, error: false });
  });

  it('flags any other failure and raises no toast', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(toasts, 'error').mockImplementation((message: string) => {
      errors.push(message);
      return message;
    });
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'boom' }));

    crossProjectDeps.ensure('t1');
    await settle();

    expect(crossProjectDeps.get('t1')?.error).toBe(true);
    // The task detail load fails beside this one and already says so.
    expect(errors).toEqual([]);
    spy.mockRestore();
  });

  it('drops a response that a reset made stale', async () => {
    let release: (() => void) | null = null;
    fetchMock.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return jsonResponse(200, deps({ blocked_by: [remote] }));
    });

    crossProjectDeps.ensure('t1');
    await vi.waitFor(() => expect(release).not.toBeNull());
    crossProjectDeps.reset();
    release!();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(crossProjectDeps.get('t1')).toBeUndefined();
  });

  it('forget drops one task without touching the others', async () => {
    crossProjectDeps.ensure('t1');
    await settle();
    crossProjectDeps.ensure('t2');
    await vi.waitFor(() => expect(crossProjectDeps.get('t2')?.loading).toBe(false));

    crossProjectDeps.forget('t1');
    expect(crossProjectDeps.get('t1')).toBeUndefined();
    expect(crossProjectDeps.get('t2')).toBeDefined();
  });
});
