import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { projects, type Project } from './projects.svelte';
import { toasts } from './toasts.svelte';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    name: 'Alpha',
    description: '',
    is_template: false,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    open_task_count: 0,
    done_task_count: 0,
    ...overrides,
  };
}

function projectRow(item: Project): Omit<Project, 'open_task_count' | 'done_task_count'> {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    is_template: item.is_template,
    archived_at: item.archived_at,
    created_at: item.created_at,
  };
}

function boardPayload(id: string, name: string, tasksInColumns: string[] = []): unknown {
  return {
    project: {
      id,
      name,
      description: '',
      is_template: false,
      archived_at: null,
      created_at: '2026-03-01T00:00:00.000Z',
    },
    columns: [
      { id: 'col-open', name: 'To Do', position: 1000, is_done: false },
      { id: 'col-done', name: 'Done', position: 2000, is_done: true },
    ],
    tasks: tasksInColumns.map((columnId, index) => ({ id: `t-${index}`, column_id: columnId })),
    labels: [],
  };
}

async function loadWith(items: Project[]): Promise<void> {
  fetchMock.mockImplementationOnce(async () => jsonResponse(200, { projects: items }));
  await projects.load();
}

async function bodyOf(request: Request): Promise<unknown> {
  return request.clone().json();
}

beforeEach(() => {
  fetchMock.mockReset();
  projects.reset();
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
});

describe('projects store', () => {
  it('loads projects and groups active, templates, and archived', async () => {
    const active = project();
    const template = project({
      id: 'p-2',
      name: 'Starter',
      is_template: true,
      created_at: '2026-01-02T00:00:00.000Z',
    });
    const archived = project({
      id: 'p-3',
      name: 'Old',
      archived_at: '2026-02-01T00:00:00.000Z',
      created_at: '2026-01-03T00:00:00.000Z',
    });
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { projects: [archived, template, active] })
    );

    await projects.load();

    expect(requestAt(0).method).toBe('GET');
    expect(new URL(requestAt(0).url).pathname).toBe('/api/projects');
    expect(projects.active).toEqual([active]);
    expect(projects.templates).toEqual([template]);
    expect(projects.archived).toEqual([archived]);
    expect(projects.loaded).toBe(true);
    expect(projects.loadError).toBeNull();
  });

  it('records a load error without marking the store loaded', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'boom' }));

    await projects.load();

    expect(projects.loadError).toBe('boom');
    expect(projects.loaded).toBe(false);
  });

  it('creates a project optimistically and reconciles from the board payload', async () => {
    fetchMock.mockImplementation(async (input) => {
      const body = (await (input as Request).clone().json()) as { id: string; name: string };
      return jsonResponse(201, boardPayload(body.id, body.name));
    });

    const pending = projects.create('New Game');
    expect(projects.active.map((p) => p.name)).toEqual(['New Game']);

    const id = await pending;

    expect(id).not.toBeNull();
    expect(requestAt(0).method).toBe('POST');
    expect(new URL(requestAt(0).url).pathname).toBe('/api/projects');
    expect(await bodyOf(requestAt(0))).toEqual({ id, name: 'New Game' });
    const created = projects.active[0]!;
    expect(created.id).toBe(id);
    expect(created.created_at).toBe('2026-03-01T00:00:00.000Z');
    expect(created.open_task_count).toBe(0);
    expect(created.done_task_count).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('toasts and refetches when create fails', async () => {
    const existing = project();
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'POST') {
        return jsonResponse(409, { error: 'Duplicate id' });
      }
      return jsonResponse(200, { projects: [existing] });
    });

    const id = await projects.create('Doomed');

    expect(id).toBeNull();
    expect(toasts.toasts.map((t) => t.message)).toEqual(['Duplicate id']);
    expect(projects.projects).toEqual([existing]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('creates from a template and derives counts from the payload', async () => {
    fetchMock.mockImplementation(async (input) => {
      const body = (await (input as Request).clone().json()) as { id: string; name: string };
      return jsonResponse(
        201,
        boardPayload(body.id, body.name, ['col-open', 'col-open', 'col-done'])
      );
    });

    const id = await projects.createFromTemplate('tpl-1', 'From Template');

    expect(await bodyOf(requestAt(0))).toEqual({
      id,
      name: 'From Template',
      source_project_id: 'tpl-1',
    });
    const created = projects.projects.find((p) => p.id === id)!;
    expect(created.open_task_count).toBe(2);
    expect(created.done_task_count).toBe(1);
  });

  it('archives optimistically and PATCHes archived_at', async () => {
    const item = project();
    await loadWith([item]);
    fetchMock.mockImplementation(async (input) => {
      const body = (await (input as Request).clone().json()) as { archived_at: string };
      return jsonResponse(200, { ...projectRow(item), archived_at: body.archived_at });
    });

    const pending = projects.archive('p-1');
    expect(projects.archived.map((p) => p.id)).toEqual(['p-1']);

    await pending;

    expect(requestAt(1).method).toBe('PATCH');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/projects/p-1');
    const body = (await bodyOf(requestAt(1))) as { archived_at: unknown };
    expect(typeof body.archived_at).toBe('string');
    expect(projects.active).toEqual([]);
    expect(projects.archived).toHaveLength(1);
  });

  it('unarchives with a null archived_at', async () => {
    const item = project({ archived_at: '2026-02-01T00:00:00.000Z' });
    await loadWith([item]);
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { ...projectRow(item), archived_at: null })
    );

    await projects.unarchive('p-1');

    expect(await bodyOf(requestAt(1))).toEqual({ archived_at: null });
    expect(projects.active.map((p) => p.id)).toEqual(['p-1']);
    expect(projects.archived).toEqual([]);
  });

  it('renames optimistically and refetches on failure', async () => {
    const item = project({ name: 'Old name' });
    await loadWith([item]);
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'PATCH') {
        return jsonResponse(500, { error: 'nope' });
      }
      return jsonResponse(200, { projects: [item] });
    });

    const pending = projects.rename('p-1', 'New name');
    expect(projects.projects[0]!.name).toBe('New name');

    await pending;

    expect(await bodyOf(requestAt(1))).toEqual({ name: 'New name' });
    expect(projects.projects[0]!.name).toBe('Old name');
    expect(toasts.toasts.map((t) => t.message)).toEqual(['nope']);
  });

  it('marks a project as a template', async () => {
    const item = project();
    await loadWith([item]);
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { ...projectRow(item), is_template: true })
    );

    await projects.setTemplate('p-1', true);

    expect(await bodyOf(requestAt(1))).toEqual({ is_template: true });
    expect(projects.templates.map((p) => p.id)).toEqual(['p-1']);
    expect(projects.active).toEqual([]);
  });

  it('removes optimistically and sends the DELETE', async () => {
    await loadWith([project()]);
    fetchMock.mockImplementation(async () => jsonResponse(204));

    const pending = projects.remove('p-1');
    expect(projects.projects).toEqual([]);

    await pending;

    expect(requestAt(1).method).toBe('DELETE');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/projects/p-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(toasts.toasts).toEqual([]);
  });

  it('restores the list when delete fails', async () => {
    const item = project();
    await loadWith([item]);
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'DELETE') {
        return jsonResponse(500, { error: 'nope' });
      }
      return jsonResponse(200, { projects: [item] });
    });

    await projects.remove('p-1');

    expect(projects.projects).toEqual([item]);
    expect(toasts.toasts.map((t) => t.message)).toEqual(['nope']);
  });

  it('reset clears all state', async () => {
    await loadWith([project()]);

    projects.reset();

    expect(projects.projects).toEqual([]);
    expect(projects.loaded).toBe(false);
    expect(projects.loadError).toBeNull();
  });
});
