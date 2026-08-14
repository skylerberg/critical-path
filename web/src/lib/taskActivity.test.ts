import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { taskActivity, type TaskActivityEntry } from './taskActivity.svelte';

function entry(id: string, kind: TaskActivityEntry['kind'] = 'created'): TaskActivityEntry {
  return {
    id,
    kind,
    actor_user_id: 'u1',
    old_value: null,
    new_value: { text: 'a card' },
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function activityFor(taskId: string): TaskActivityEntry[] {
  return [entry(`${taskId}-a`)];
}

beforeEach(() => {
  fetchMock.mockReset();
  taskActivity.reset();
  fetchMock.mockImplementation(async (input) => {
    const path = new URL((input as Request).url).pathname;
    const taskId = path.split('/')[3] ?? '';
    return jsonResponse(200, { activity: activityFor(taskId) });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('taskActivity store', () => {
  it('loads a task log', async () => {
    await taskActivity.load('t1');

    expect(new URL(requestAt(0).url).pathname).toBe('/api/tasks/t1/activity');
    expect(taskActivity.entries).toEqual(activityFor('t1'));
    expect(taskActivity.loading).toBe(false);
    expect(taskActivity.error).toBe(false);
  });

  it('clears another task’s entries before its own response lands', async () => {
    await taskActivity.load('t1');

    const pending = taskActivity.load('t2');
    expect(taskActivity.entries).toEqual([]);
    expect(taskActivity.loading).toBe(true);

    await pending;
    expect(taskActivity.entries).toEqual(activityFor('t2'));
  });

  it('keeps the current entries visible while reloading the same task', async () => {
    await taskActivity.load('t1');

    const pending = taskActivity.load('t1');
    expect(taskActivity.entries).toEqual(activityFor('t1'));

    await pending;
  });

  it('discards a response the open task moved past', async () => {
    let releaseFirst: (() => void) | undefined;
    fetchMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (releaseFirst = resolve));
      return jsonResponse(200, { activity: activityFor('t1') });
    });

    const stale = taskActivity.load('t1');
    await taskActivity.load('t2');
    releaseFirst?.();
    await stale;

    expect(taskActivity.entries).toEqual(activityFor('t2'));
  });

  // The log refetches on every write to the open card, so a failing read is
  // routinely overtaken; landing it anyway puts the error state — or, on a 404,
  // an empty log — over entries the card is already showing.
  it('leaves the log alone when a failure lands after the task moved on', async () => {
    let failStale!: () => void;
    fetchMock.mockImplementationOnce(
      async () =>
        new Promise<Response>((resolve) => {
          failStale = () => resolve(jsonResponse(404, { error: 'Task not found' }));
        })
    );

    const stale = taskActivity.load('t1');
    await taskActivity.load('t2');
    failStale();
    await stale;

    expect(taskActivity.entries).toEqual(activityFor('t2'));
    expect(taskActivity.error).toBe(false);
    expect(taskActivity.loading).toBe(false);
  });

  it('reports a failed load without throwing', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));

    await taskActivity.load('t1');

    expect(taskActivity.error).toBe(true);
    expect(taskActivity.entries).toEqual([]);
    expect(taskActivity.loading).toBe(false);
  });

  it('keeps the loaded log when a refresh fails', async () => {
    await taskActivity.load('t1');
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));

    await taskActivity.load('t1');

    expect(taskActivity.error).toBe(true);
    expect(taskActivity.entries).toEqual(activityFor('t1'));
  });

  // TaskHistory renders the failure notice above the list rather than instead of
  // it, so an error left set outlives the failure as a banner over a current log.
  it('clears the failure once the same task loads again', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));
    await taskActivity.load('t1');
    expect(taskActivity.error).toBe(true);

    await taskActivity.load('t1');

    expect(taskActivity.error).toBe(false);
    expect(taskActivity.entries).toEqual(activityFor('t1'));
  });

  it('empties the log when a refresh finds the task gone', async () => {
    await taskActivity.load('t1');
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Task not found' }));

    await taskActivity.load('t1');

    expect(taskActivity.error).toBe(false);
    expect(taskActivity.entries).toEqual([]);
  });

  it('treats a missing task as an empty log', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Task not found' }));

    await taskActivity.load('t1');

    expect(taskActivity.error).toBe(false);
    expect(taskActivity.entries).toEqual([]);
  });

  it('ignores invalidation for a task that is not open', async () => {
    await taskActivity.load('t1');

    taskActivity.invalidate('t2');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches immediately once the refresh window has passed', async () => {
    vi.useFakeTimers();
    await taskActivity.load('t1');
    vi.advanceTimersByTime(1000);

    taskActivity.invalidate('t1');
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('collapses a burst inside the window into one trailing refetch', async () => {
    vi.useFakeTimers();
    await taskActivity.load('t1');

    taskActivity.invalidate('t1');
    taskActivity.invalidate('t1');
    taskActivity.invalidate('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // The overlay resets on unmount, so a response in flight belongs to a card the
  // reader has already left; landing it would flash that history into the next one.
  it('discards a response still in flight when the overlay resets', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    fetchMock.mockImplementationOnce(async () => {
      await held;
      return jsonResponse(200, { activity: activityFor('t1') });
    });

    const pending = taskActivity.load('t1');
    taskActivity.reset();
    release();
    await pending;

    expect(taskActivity.entries).toEqual([]);
    expect(taskActivity.loading).toBe(false);
  });

  it('cancels a pending refetch on reset', async () => {
    vi.useFakeTimers();
    await taskActivity.load('t1');
    taskActivity.invalidate('t1');

    taskActivity.reset();
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(taskActivity.entries).toEqual([]);
  });
});
