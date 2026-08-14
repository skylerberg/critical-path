import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { mutationFailed } from './store-sync';
import { toasts } from './toasts.svelte';

function store(currentProjectId: string | null) {
  return { currentProjectId, load: vi.fn(async () => {}) };
}

beforeEach(() => {
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
});

describe('mutationFailed', () => {
  it('reports what the server said and re-reads the project', async () => {
    const target = store('p-1');

    await mutationFailed(target, new ApiError(409, 'Already archived'), 'Failed to archive');

    expect(toasts.toasts.map((toast) => toast.message)).toEqual(['Already archived']);
    expect(target.load).toHaveBeenCalledWith('p-1');
  });

  it('falls back to the caller’s wording when the request never landed', async () => {
    const target = store('p-1');

    await mutationFailed(target, new TypeError('Failed to fetch'), 'Failed to archive');

    expect(toasts.toasts.map((toast) => toast.message)).toEqual(['Failed to archive']);
  });

  // A store whose project closed under the failure has nothing to re-read, and
  // load(null) would be a request for a board nobody is looking at.
  it('skips the re-read when no project is open', async () => {
    const target = store(null);

    await mutationFailed(target, new ApiError(500, 'Boom'), 'Failed to archive');

    expect(toasts.toasts.map((toast) => toast.message)).toEqual(['Boom']);
    expect(target.load).not.toHaveBeenCalled();
  });

  // The re-read is held open by the test rather than by a microtask: a load that
  // finishes on its own settles before the assertion can run either way, which is
  // the same reading a caller that never awaited it would give.
  it('resolves only once the re-read has, so a caller can rethrow after it', async () => {
    let finishLoad = (): void => {};
    const target = {
      currentProjectId: 'p-1',
      load: vi.fn(
        async () =>
          new Promise<void>((resolve) => {
            finishLoad = resolve;
          })
      ),
    };

    let settled = false;
    const failing = mutationFailed(target, new ApiError(500, 'Boom'), 'Failed to archive').then(
      () => {
        settled = true;
      }
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(target.load).toHaveBeenCalledWith('p-1');
    expect(settled).toBe(false);

    finishLoad();
    await failing;

    expect(settled).toBe(true);
  });
});
