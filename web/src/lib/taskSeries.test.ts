import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskSeries, type TaskSeries } from './taskSeries.svelte';
import { toasts } from './toasts.svelte';

function series(overrides: Partial<TaskSeries> = {}): TaskSeries {
  return {
    id: 's-1',
    project_id: 'p-1',
    column_id: 'c-1',
    title: 'Weekly review',
    description: null,
    due_date: null,
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    preset: 'weekly',
    summary: 'Every Monday',
    start_date: '2026-02-02',
    timezone: 'Europe/Berlin',
    status: 'active',
    next_occurrence_date: '2026-02-09',
    last_occurrence_date: null,
    missed_occurrence_count: 0,
    last_missed_date: null,
    open_occurrence_count: 0,
    last_error: null,
    ended_at: null,
    created_by: 'u-1',
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
    label_ids: [],
    assignee_ids: [],
    checklist_items: [],
    ...overrides,
  };
}

async function loadWith(items: TaskSeries[], projectId = 'p-1'): Promise<void> {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { series: items }));
  await taskSeries.load(projectId);
}

beforeEach(() => {
  fetchMock.mockReset();
  taskSeries.reset();
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
});

describe('task series store', () => {
  it('loads a project’s series', async () => {
    await loadWith([series()]);

    expect(taskSeries.list).toEqual([series()]);
    expect(taskSeries.loaded).toBe(true);
    expect(taskSeries.loadError).toBeNull();
    expect(requestAt(0).url).toContain('/api/task-series?project_id=p-1');
  });

  it('records a load failure instead of throwing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: 'Service unavailable' }));
    await expect(taskSeries.load('p-1')).resolves.toBeUndefined();

    expect(taskSeries.loadError).toBe('Service unavailable');
    expect(taskSeries.loaded).toBe(false);
  });

  it('clears the previous project before the next one lands', async () => {
    await loadWith([series()]);

    let resolveSecond: ((value: Response) => void) | undefined;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveSecond = resolve;
      })
    );
    const pending = taskSeries.load('p-2');
    expect(taskSeries.list).toEqual([]);
    expect(taskSeries.loaded).toBe(false);
    expect(taskSeries.currentProjectId).toBe('p-2');

    resolveSecond?.(jsonResponse(200, { series: [series({ id: 's-2', project_id: 'p-2' })] }));
    await pending;
    expect(taskSeries.list.map((row) => row.id)).toEqual(['s-2']);
  });

  it('drops a response that a later read has already superseded', async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      })
    );
    const stale = taskSeries.load('p-1');

    await loadWith([series({ id: 'fresh' })]);

    resolveFirst?.(jsonResponse(200, { series: [series({ id: 'stale' })] }));
    await stale;
    expect(taskSeries.list.map((row) => row.id)).toEqual(['fresh']);
  });

  it('invalidates an in-flight read on reset', async () => {
    let resolveRead: ((value: Response) => void) | undefined;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveRead = resolve;
      })
    );
    const pending = taskSeries.load('p-1');
    taskSeries.reset();

    resolveRead?.(jsonResponse(200, { series: [series()] }));
    await pending;
    expect(taskSeries.list).toEqual([]);
    expect(taskSeries.currentProjectId).toBeNull();
  });

  it('inserts the server row on create and rethrows a rejection', async () => {
    await loadWith([]);

    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { ...series({ id: 'created' }), dropped_image_count: 0 })
    );
    await taskSeries.create({
      id: 'created',
      project_id: 'p-1',
      column_id: 'c-1',
      title: 'Weekly review',
      start_date: '2026-02-02',
      timezone: 'Europe/Berlin',
      preset: 'weekly',
    });
    expect(taskSeries.list.map((row) => row.id)).toEqual(['created']);

    fetchMock.mockResolvedValueOnce(jsonResponse(422, { error: 'rrule must be parseable' }));
    await expect(
      taskSeries.create({
        id: 'nope',
        project_id: 'p-1',
        column_id: 'c-1',
        title: 'bad',
        start_date: '2026-02-02',
        timezone: 'Europe/Berlin',
        rrule: 'nonsense',
      })
    ).rejects.toThrow('rrule must be parseable');
    expect(taskSeries.list.map((row) => row.id)).toEqual(['created']);
  });

  it('replaces the row on a successful patch and rethrows a rejection', async () => {
    await loadWith([series()]);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, series({ title: 'Renamed' })));
    await taskSeries.patch('s-1', { title: 'Renamed' });
    expect(taskSeries.list[0].title).toBe('Renamed');

    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: 'Read-only access to this project' })
    );
    await expect(taskSeries.patch('s-1', { title: 'again' })).rejects.toThrow(
      'Read-only access to this project'
    );
  });

  it('pauses optimistically and refetches after a failure', async () => {
    await loadWith([series()]);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, series({ status: 'paused' })));
    await taskSeries.setPaused('s-1', true);
    expect(taskSeries.list[0].status).toBe('paused');
    expect(JSON.parse(String(await requestAt(1).text()))).toEqual({ status: 'paused' });

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'Boom' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { series: [series({ status: 'paused' })] }));
    await taskSeries.setPaused('s-1', false);

    expect(toasts.toasts.map((toast) => toast.message)).toEqual(['Boom']);
    expect(taskSeries.list[0].status).toBe('paused');
    expect(requestAt(3).url).toContain('/api/task-series?project_id=p-1');
  });

  it('removes optimistically and refetches after a failure', async () => {
    await loadWith([series(), series({ id: 's-2' })]);

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await taskSeries.remove('s-1');
    expect(taskSeries.list.map((row) => row.id)).toEqual(['s-2']);

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'Nope' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { series: [series({ id: 's-2' })] }));
    await taskSeries.remove('s-2');

    expect(toasts.toasts.map((toast) => toast.message)).toEqual(['Nope']);
    expect(taskSeries.list.map((row) => row.id)).toEqual(['s-2']);
  });

  it('zeroes the missed counter optimistically', async () => {
    await loadWith([series({ missed_occurrence_count: 4, last_missed_date: '2026-02-01' })]);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, series()));
    await taskSeries.clearMissed('s-1');

    expect(taskSeries.list[0].missed_occurrence_count).toBe(0);
    expect(taskSeries.list[0].last_missed_date).toBeNull();
    expect(JSON.parse(String(await requestAt(1).text()))).toEqual({ clear_missed: true });
  });
});

describe('task series realtime events', () => {
  function event(type: string, data: unknown, projectId: string | null = 'p-1') {
    return { type, project_id: projectId, data };
  }

  it('appends a series someone else created', async () => {
    await loadWith([series()]);

    taskSeries.applyRealtime(event('series_created', series({ id: 's-2', title: 'Theirs' })));

    expect(taskSeries.list.map((row) => row.id)).toEqual(['s-1', 's-2']);
  });

  it('does not double a row when our own create echoes back', async () => {
    await loadWith([]);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { ...series({ id: 'mine' }), dropped_image_count: 0 })
    );
    await taskSeries.create({
      id: 'mine',
      project_id: 'p-1',
      column_id: 'c-1',
      title: 'Weekly review',
      start_date: '2026-02-02',
      timezone: 'Europe/Berlin',
      preset: 'weekly',
    });

    taskSeries.applyRealtime(event('series_created', series({ id: 'mine', title: 'Renamed' })));

    expect(taskSeries.list.map((row) => row.id)).toEqual(['mine']);
    expect(taskSeries.list[0].title).toBe('Renamed');
  });

  it('applies an edit, a pause and an advanced schedule in place', async () => {
    await loadWith([series(), series({ id: 's-2' })]);

    taskSeries.applyRealtime(event('series_updated', series({ title: 'Renamed elsewhere' })));
    expect(taskSeries.list[0].title).toBe('Renamed elsewhere');

    taskSeries.applyRealtime(event('series_updated', series({ status: 'paused' })));
    expect(taskSeries.list[0].status).toBe('paused');

    taskSeries.applyRealtime(
      event(
        'series_updated',
        series({ next_occurrence_date: '2026-02-16', open_occurrence_count: 2 })
      )
    );
    expect(taskSeries.list[0].next_occurrence_date).toBe('2026-02-16');
    expect(taskSeries.list[0].open_occurrence_count).toBe(2);
    expect(taskSeries.list.map((row) => row.id)).toEqual(['s-1', 's-2']);
  });

  it('never resurrects a row an update arrives for after it is gone', async () => {
    await loadWith([series()]);

    taskSeries.applyRealtime(event('series_deleted', { id: 's-1' }));
    expect(taskSeries.list).toEqual([]);

    taskSeries.applyRealtime(event('series_updated', series({ title: 'Ghost' })));
    expect(taskSeries.list).toEqual([]);
  });

  it('ignores events for another project and events that arrive before the list', async () => {
    await loadWith([series()]);

    taskSeries.applyRealtime(event('series_created', series({ id: 'elsewhere' }), 'p-9'));
    taskSeries.applyRealtime(event('series_deleted', { id: 's-1' }, null));
    expect(taskSeries.list.map((row) => row.id)).toEqual(['s-1']);

    taskSeries.reset();
    taskSeries.applyRealtime(event('series_created', series({ id: 'early' })));
    expect(taskSeries.list).toEqual([]);
  });

  it('ignores an unrelated event type', async () => {
    await loadWith([series()]);

    taskSeries.applyRealtime(event('task_created', { id: 't-1' }));

    expect(taskSeries.list.map((row) => row.id)).toEqual(['s-1']);
  });

  it('re-reads the list on resync, and does nothing without a project', async () => {
    await loadWith([series()]);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { series: [series({ id: 'refetched' })] }));
    taskSeries.resync();
    await vi.waitFor(() => expect(taskSeries.list.map((row) => row.id)).toEqual(['refetched']));

    taskSeries.reset();
    fetchMock.mockClear();
    taskSeries.resync();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
