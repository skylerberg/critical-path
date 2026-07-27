import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { descriptionText, taskActivity, type TaskActivityEntry } from './taskActivity.svelte';

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

  it('reports a failed load without throwing', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));

    await taskActivity.load('t1');

    expect(taskActivity.error).toBe(true);
    expect(taskActivity.entries).toEqual([]);
    expect(taskActivity.loading).toBe(false);
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

describe('descriptionText', () => {
  it('flattens nested nodes and separates blocks', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }],
            },
          ],
        },
      ],
    };

    expect(descriptionText(doc)).toBe('first second');
  });

  it('is empty for a missing document', () => {
    expect(descriptionText(null)).toBe('');
    expect(descriptionText(undefined)).toBe('');
    expect(descriptionText({ type: 'doc' })).toBe('');
  });
});
