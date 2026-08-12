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

  it('resolves only once the re-read has, so a caller can rethrow after it', async () => {
    let settled = false;
    const target = {
      currentProjectId: 'p-1',
      load: vi.fn(async () => {
        await Promise.resolve();
        settled = true;
      }),
    };

    await mutationFailed(target, new ApiError(500, 'Boom'), 'Failed to archive');

    expect(settled).toBe(true);
  });
});
