import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { invitations } from './invitations.svelte';
import { isProjectOwner, projects, type Project } from './projects.svelte';
import { session } from './session.svelte';
import { toasts } from './toasts.svelte';
import { users } from './users.svelte';

function project(overrides: Partial<Project> = {}): Project {
  const memberIds = overrides.member_ids ?? [];
  return {
    id: 'p-1',
    name: 'Alpha',
    description: '',
    archived_at: null,
    created_by: null,
    member_ids: memberIds,
    members: memberIds.map((user_id) => ({ user_id, role: 'editor' as const })),
    is_public: false,
    created_at: '2026-01-01T00:00:00.000Z',
    open_task_count: 0,
    done_task_count: 0,
    position: null,
    ...overrides,
  };
}

function projectRow(
  item: Project
): Omit<Project, 'open_task_count' | 'done_task_count' | 'position'> {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    archived_at: item.archived_at,
    created_by: item.created_by,
    member_ids: item.member_ids,
    members: item.members,
    is_public: item.is_public,
    created_at: item.created_at,
  };
}

function boardPayload(id: string, name: string, tasksInColumns: string[] = []): unknown {
  return {
    project: {
      id,
      name,
      description: '',
      archived_at: null,
      created_by: null,
      member_ids: [],
      members: [],
      is_public: false,
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
  invitations.reset();
  projects.reset();
  users.reset();
  session.user = null;
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
});

describe('projects store', () => {
  it('loads projects and groups active and archived', async () => {
    const first = project();
    const second = project({
      id: 'p-2',
      name: 'Beta',
      created_at: '2026-01-02T00:00:00.000Z',
    });
    const archived = project({
      id: 'p-3',
      name: 'Old',
      archived_at: '2026-02-01T00:00:00.000Z',
      created_at: '2026-01-03T00:00:00.000Z',
    });
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { projects: [archived, second, first] })
    );

    await projects.load();

    expect(requestAt(0).method).toBe('GET');
    expect(new URL(requestAt(0).url).pathname).toBe('/api/projects');
    expect(projects.active).toEqual([first, second]);
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
    expect(created.member_ids).toEqual([]);
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

  it('copies a project and derives counts from the payload', async () => {
    fetchMock.mockImplementation(async (input) => {
      const body = (await (input as Request).clone().json()) as { id: string; name: string };
      return jsonResponse(
        201,
        boardPayload(body.id, body.name, ['col-open', 'col-open', 'col-done'])
      );
    });

    const id = await projects.copy('src-1', 'Alpha copy');

    expect(await bodyOf(requestAt(0))).toEqual({
      id,
      name: 'Alpha copy',
      source_project_id: 'src-1',
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

  it('still sends the DELETE for a board it does not own, and restores it on refusal', async () => {
    session.user = {
      id: 'u-me',
      email: 'me@example.com',
      name: 'Me',
      avatar_url: null,
      email_verified: false,
    };
    const item = project({ created_by: 'u-other' });
    await loadWith([item]);
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'DELETE') {
        return jsonResponse(403, { error: 'Only the project owner can delete this project' });
      }
      return jsonResponse(200, { projects: [item] });
    });

    await projects.remove('p-1');

    expect(requestAt(1).method).toBe('DELETE');
    expect(projects.projects).toEqual([item]);
    expect(toasts.toasts.map((t) => t.message)).toEqual([
      'Only the project owner can delete this project',
    ]);
  });

  it('reset clears all state', async () => {
    await loadWith([project()]);

    projects.reset();

    expect(projects.projects).toEqual([]);
    expect(projects.loaded).toBe(false);
    expect(projects.loadError).toBeNull();
  });

  it('sets members optimistically and PUTs the full set', async () => {
    const item = project({ member_ids: ['u-1'] });
    await loadWith([item]);
    fetchMock.mockImplementation(async () => jsonResponse(204));

    const pending = projects.setMembers('p-1', ['u-1', 'u-2']);
    expect(projects.projects[0]!.member_ids).toEqual(['u-1', 'u-2']);

    await pending;

    expect(requestAt(1).method).toBe('PUT');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/projects/p-1/members');
    expect(await bodyOf(requestAt(1))).toEqual({ user_ids: ['u-1', 'u-2'] });
    expect(toasts.toasts).toEqual([]);
  });

  it('toasts and refetches when setting members fails', async () => {
    const item = project({ member_ids: ['u-1'] });
    await loadWith([item]);
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'PUT') {
        return jsonResponse(422, { error: 'Unknown user' });
      }
      return jsonResponse(200, { projects: [item] });
    });

    await projects.setMembers('p-1', ['u-1', 'u-missing']);

    expect(projects.projects[0]!.member_ids).toEqual(['u-1']);
    expect(toasts.toasts.map((t) => t.message)).toEqual(['Unknown user']);
  });

  it('adds a member by id, appending to the existing set', async () => {
    await loadWith([project({ created_by: 'u-me', member_ids: ['u-1'] })]);
    fetchMock.mockImplementation(async () => jsonResponse(204));

    const pending = projects.addMember('p-1', 'u-2');
    expect(projects.projects[0]!.member_ids).toEqual(['u-1', 'u-2']);

    await pending;

    expect(requestAt(1).method).toBe('PUT');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/projects/p-1/members');
    expect(await bodyOf(requestAt(1))).toEqual({ user_ids: ['u-1', 'u-2'] });
  });

  it('does not re-add the creator or an existing member', async () => {
    await loadWith([project({ created_by: 'u-me', member_ids: ['u-1'] })]);

    await projects.addMember('p-1', 'u-me');
    await projects.addMember('p-1', 'u-1');
    await projects.addMember('p-missing', 'u-2');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(projects.projects[0]!.member_ids).toEqual(['u-1']);
  });

  it('adds a member by email and appends the returned user', async () => {
    const item = project({ created_by: 'u-me', member_ids: ['u-1'] });
    await loadWith([item]);
    const added = { id: 'u-2', name: 'Pat', avatar_url: null };
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { status: 'member', role: 'editor', user: added, invitation: null })
    );

    const result = await projects.addMemberByEmail('p-1', 'pat@example.com');

    expect(result).toEqual({ ok: true, status: 'member', name: 'Pat' });
    expect(requestAt(1).method).toBe('POST');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/projects/p-1/members/by-email');
    expect(await bodyOf(requestAt(1))).toEqual({ email: 'pat@example.com' });
    expect(projects.projects[0]!.member_ids).toEqual(['u-1', 'u-2']);
    expect(users.byId('u-2')).toEqual(added);
  });

  it('does not list the creator when added by their own email', async () => {
    const owner = { id: 'u-me', name: 'Me', avatar_url: null };
    await loadWith([project({ created_by: 'u-me' })]);
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { status: 'member', role: 'editor', user: owner, invitation: null })
    );

    const result = await projects.addMemberByEmail('p-1', 'me@example.com');

    expect(result).toEqual({ ok: true, status: 'member', name: 'Me' });
    expect(projects.projects[0]!.member_ids).toEqual([]);
  });

  // A null user read through throws, and the throw is swallowed as a generic
  // failure, so `ok` is what catches a client still expecting a member here.
  it('reports an invitation for an address with no account, adding nobody', async () => {
    await loadWith([project({ created_by: 'u-me' })]);
    const created = {
      id: 'inv-1',
      project_id: 'p-1',
      email: 'ghost@example.com',
      role: 'editor',
      invited_by: 'u-me',
      created_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2026-01-15T00:00:00.000Z',
    };
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { status: 'invited', role: 'editor', user: null, invitation: created })
    );

    const result = await projects.addMemberByEmail('p-1', 'ghost@example.com');

    expect(result).toEqual({ ok: true, status: 'invited' });
    expect(projects.projects[0]!.member_ids).toEqual([]);
    expect(projects.projects[0]!.members).toEqual([]);
    expect(toasts.toasts).toEqual([]);
  });

  it('hands a pending invitation to the invitations store when that board is open', async () => {
    await loadWith([project({ created_by: 'u-me' })]);
    const created = {
      id: 'inv-1',
      project_id: 'p-1',
      email: 'ghost@example.com',
      role: 'editor' as const,
      invited_by: 'u-me',
      created_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2026-01-15T00:00:00.000Z',
    };
    fetchMock.mockImplementation(async () => jsonResponse(200, { invitations: [] }));
    await invitations.load('p-1');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { status: 'invited', role: 'editor', user: null, invitation: created })
    );

    await projects.addMemberByEmail('p-1', 'ghost@example.com');

    expect(invitations.list).toEqual([created]);
  });

  // 404 no longer means "no such address" — it means no access to this board — so
  // reporting it as an unknown user would be a lie.
  it('passes a genuine 404 through as the server worded it, without toasting', async () => {
    await loadWith([project()]);
    fetchMock.mockImplementation(async () => jsonResponse(404, { error: 'Project not found' }));

    const result = await projects.addMemberByEmail('p-1', 'ghost@example.com');

    expect(result).toEqual({ ok: false, error: 'Project not found' });
    expect(projects.projects[0]!.member_ids).toEqual([]);
    expect(toasts.toasts).toEqual([]);
  });

  it('transfers ownership optimistically and merges the returned row', async () => {
    session.user = {
      id: 'u-me',
      email: 'me@example.com',
      name: 'Me',
      avatar_url: null,
      email_verified: false,
    };
    const item = project({ created_by: 'u-me', member_ids: ['u-ada', 'u-2'] });
    await loadWith([item]);
    const confirmed = projectRow(project({ created_by: 'u-ada', member_ids: ['u-2', 'u-me'] }));
    fetchMock.mockImplementation(async () => jsonResponse(200, confirmed));

    const pending = projects.transferOwnership('p-1', 'u-ada');
    expect(projects.projects[0]!.created_by).toBe('u-ada');
    expect(projects.projects[0]!.member_ids).toEqual(['u-2', 'u-me']);

    await pending;

    expect(requestAt(1).method).toBe('PUT');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/projects/p-1/owner');
    expect(await bodyOf(requestAt(1))).toEqual({ user_id: 'u-ada' });
    expect(projects.projects[0]!.created_by).toBe('u-ada');
    expect(projects.projects[0]!.member_ids).toEqual(['u-2', 'u-me']);
    expect(toasts.toasts).toEqual([]);
  });

  it('toasts and refetches when the server refuses a transfer', async () => {
    session.user = {
      id: 'u-me',
      email: 'me@example.com',
      name: 'Me',
      avatar_url: null,
      email_verified: false,
    };
    const item = project({ created_by: 'u-me', member_ids: ['u-ada'] });
    await loadWith([item]);
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'PUT') {
        return jsonResponse(403, { error: 'Only the project owner can transfer ownership' });
      }
      return jsonResponse(200, { projects: [item] });
    });

    await projects.transferOwnership('p-1', 'u-ada');

    expect(projects.projects[0]!.created_by).toBe('u-me');
    expect(projects.projects[0]!.member_ids).toEqual(['u-ada']);
    expect(toasts.toasts.map((t) => t.message)).toEqual([
      'Only the project owner can transfer ownership',
    ]);
  });

  it('does not transfer ownership while signed out', async () => {
    await loadWith([project({ created_by: 'u-me', member_ids: ['u-ada'] })]);

    await projects.transferOwnership('p-1', 'u-ada');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(projects.projects[0]!.created_by).toBe('u-me');
  });

  it('leave PUTs the member set minus self and drops the project', async () => {
    session.user = {
      id: 'u-me',
      email: 'me@example.com',
      name: 'Me',
      avatar_url: null,
      email_verified: false,
    };
    await loadWith([project({ created_by: 'u-owner', member_ids: ['u-me', 'u-2'] })]);
    fetchMock.mockImplementation(async () => jsonResponse(204));

    const pending = projects.leave('p-1');
    expect(projects.projects).toEqual([]);

    await pending;

    expect(requestAt(1).method).toBe('PUT');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/projects/p-1/members');
    expect(await bodyOf(requestAt(1))).toEqual({ user_ids: ['u-2'] });
    expect(toasts.toasts).toEqual([]);
  });

  it('restores the list when leaving fails', async () => {
    session.user = {
      id: 'u-me',
      email: 'me@example.com',
      name: 'Me',
      avatar_url: null,
      email_verified: false,
    };
    const item = project({ created_by: 'u-owner', member_ids: ['u-me'] });
    await loadWith([item]);
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'PUT') {
        return jsonResponse(500, { error: 'nope' });
      }
      return jsonResponse(200, { projects: [item] });
    });

    await projects.leave('p-1');

    expect(projects.projects).toEqual([item]);
    expect(toasts.toasts.map((t) => t.message)).toEqual(['nope']);
  });

  it('sorts positioned projects first, then nulls by created_at then id', async () => {
    const second = project({
      id: 'p-second',
      position: 2000,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const first = project({
      id: 'p-first',
      position: 1000,
      created_at: '2026-01-09T00:00:00.000Z',
    });
    const legacyA = project({ id: 'p-legacy-a', created_at: '2026-01-05T00:00:00.000Z' });
    const legacyB = project({ id: 'p-legacy-b', created_at: '2026-01-05T00:00:00.000Z' });
    await loadWith([legacyB, second, legacyA, first]);

    expect(projects.active.map((p) => p.id)).toEqual([
      'p-first',
      'p-second',
      'p-legacy-a',
      'p-legacy-b',
    ]);
  });

  it('sets a position optimistically and PUTs it', async () => {
    await loadWith([project()]);
    fetchMock.mockImplementation(async () => jsonResponse(204));

    const pending = projects.setPosition('p-1', 1500);
    expect(projects.projects[0]!.position).toBe(1500);

    await pending;

    expect(requestAt(1).method).toBe('PUT');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/projects/p-1/position');
    expect(await bodyOf(requestAt(1))).toEqual({ position: 1500 });
    expect(toasts.toasts).toEqual([]);
  });

  it('toasts and refetches when setting a position fails', async () => {
    const item = project();
    await loadWith([item]);
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'PUT') {
        return jsonResponse(500, { error: 'nope' });
      }
      return jsonResponse(200, { projects: [item] });
    });

    await projects.setPosition('p-1', 1500);

    expect(projects.projects[0]!.position).toBeNull();
    expect(toasts.toasts.map((t) => t.message)).toEqual(['nope']);
  });

  it('reorders with a single midpoint PUT when every project is positioned', async () => {
    const a = project({ id: 'p-a', position: 1000 });
    const b = project({ id: 'p-b', position: 2000 });
    const c = project({ id: 'p-c', position: 3000 });
    await loadWith([a, b, c]);
    fetchMock.mockImplementation(async () => jsonResponse(204));

    await projects.reorder('p-c', ['p-a', 'p-c', 'p-b']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestAt(1).method).toBe('PUT');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/projects/p-c/position');
    expect(await bodyOf(requestAt(1))).toEqual({ position: 1500 });
    expect(projects.active.map((p) => p.id)).toEqual(['p-a', 'p-c', 'p-b']);
  });

  it('normalizes the whole list when any position is null', async () => {
    const a = project({ id: 'p-a', position: 1000 });
    const b = project({ id: 'p-b', created_at: '2026-01-02T00:00:00.000Z' });
    const c = project({ id: 'p-c', created_at: '2026-01-03T00:00:00.000Z' });
    await loadWith([a, b, c]);
    fetchMock.mockImplementation(async () => jsonResponse(204));

    await projects.reorder('p-c', ['p-a', 'p-c', 'p-b']);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const puts = new Map<string, unknown>();
    for (const index of [1, 2, 3]) {
      expect(requestAt(index).method).toBe('PUT');
      puts.set(new URL(requestAt(index).url).pathname, await bodyOf(requestAt(index)));
    }
    expect(puts).toEqual(
      new Map<string, unknown>([
        ['/api/projects/p-a/position', { position: 1000 }],
        ['/api/projects/p-c/position', { position: 2000 }],
        ['/api/projects/p-b/position', { position: 3000 }],
      ])
    );
    expect(projects.active.map((p) => p.id)).toEqual(['p-a', 'p-c', 'p-b']);
  });

  it('applies project_position_updated to a loaded project', async () => {
    await loadWith([project()]);

    projects.applyRealtime({
      type: 'project_position_updated',
      project_id: null,
      data: { id: 'p-1', position: 750 },
    });

    expect(projects.projects[0]!.position).toBe(750);
  });

  it('preserves position through a project_updated merge', async () => {
    await loadWith([project({ position: 500 })]);

    projects.applyRealtime({
      type: 'project_updated',
      project_id: 'p-1',
      data: { id: 'p-1', name: 'Renamed' },
    });

    expect(projects.projects[0]!.position).toBe(500);
    expect(projects.projects[0]!.name).toBe('Renamed');
  });

  it('keeps the caller position when a PATCH response lacks it', async () => {
    const item = project({ position: 500, name: 'Old' });
    await loadWith([item]);
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { ...projectRow(item), name: 'New' })
    );

    await projects.rename('p-1', 'New');

    expect(projects.projects[0]!.position).toBe(500);
    expect(projects.projects[0]!.name).toBe('New');
  });
});

describe('isProjectOwner', () => {
  const me = {
    id: 'u-me',
    email: 'me@example.com',
    name: 'Me',
    avatar_url: null,
    email_verified: false,
  };

  it('is true only for the signed-in creator', () => {
    session.user = me;
    expect(isProjectOwner(project({ created_by: me.id }))).toBe(true);
    expect(isProjectOwner(project({ created_by: 'u-other' }))).toBe(false);
    expect(isProjectOwner(project({ created_by: null }))).toBe(false);
  });

  it('is false while nobody is signed in', () => {
    session.user = null;
    expect(isProjectOwner(project({ created_by: me.id }))).toBe(false);
    expect(isProjectOwner(project({ created_by: null }))).toBe(false);
  });
});

describe('project roles', () => {
  const me = {
    id: 'u-me',
    email: 'me@example.com',
    name: 'Me',
    avatar_url: null,
    email_verified: false,
  };

  it('reports canEdit from the stored role', async () => {
    session.user = me;
    await loadWith([
      project({ id: 'p-own', created_by: me.id }),
      project({
        id: 'p-edit',
        created_by: 'u-owner',
        member_ids: [me.id],
        members: [{ user_id: me.id, role: 'editor' }],
      }),
      project({
        id: 'p-view',
        created_by: 'u-owner',
        member_ids: [me.id],
        members: [{ user_id: me.id, role: 'viewer' }],
      }),
    ]);

    expect(projects.canEdit('p-own')).toBe(true);
    expect(projects.canEdit('p-edit')).toBe(true);
    expect(projects.canEdit('p-view')).toBe(false);
    expect(projects.canEdit('p-unknown')).toBe(false);
  });

  // A demotion whose realtime event never arrived is only discovered when a write
  // is rejected, and the board refetch that follows is the one carrying the truth.
  it('adopts membership the board refetched, so the list stops offering management', async () => {
    session.user = me;
    await loadWith([
      project({
        id: 'p1',
        created_by: 'u-owner',
        member_ids: [me.id],
        members: [{ user_id: me.id, role: 'editor' }],
      }),
    ]);
    expect(projects.canEdit('p1')).toBe(true);

    projects.adoptMembership({
      id: 'p1',
      created_by: 'u-owner',
      member_ids: [me.id],
      members: [{ user_id: me.id, role: 'viewer' }],
    });

    expect(projects.canEdit('p1')).toBe(false);
  });

  it('changes a role optimistically and sends roles without user_ids', async () => {
    await loadWith([
      project({
        created_by: 'u-me',
        member_ids: ['u-1', 'u-2'],
        members: [
          { user_id: 'u-1', role: 'editor' },
          { user_id: 'u-2', role: 'editor' },
        ],
      }),
    ]);
    fetchMock.mockImplementation(async () => jsonResponse(204));

    const pending = projects.setMemberRole('p-1', 'u-2', 'viewer');
    expect(projects.projects[0]!.members).toEqual([
      { user_id: 'u-1', role: 'editor' },
      { user_id: 'u-2', role: 'viewer' },
    ]);

    await pending;

    expect(requestAt(1).method).toBe('PUT');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/projects/p-1/members');
    const body = (await bodyOf(requestAt(1))) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['roles']);
    expect(body).toEqual({ roles: [{ user_id: 'u-2', role: 'viewer' }] });
    expect(projects.projects[0]!.member_ids).toEqual(['u-1', 'u-2']);
  });

  it('toasts and reloads when a role change is refused', async () => {
    const stored = project({
      created_by: 'u-owner',
      member_ids: ['u-1'],
      members: [{ user_id: 'u-1', role: 'editor' }],
    });
    await loadWith([stored]);
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'PUT') {
        return jsonResponse(403, { error: 'Read-only access to this project' });
      }
      return jsonResponse(200, { projects: [stored] });
    });

    await projects.setMemberRole('p-1', 'u-1', 'viewer');

    expect(toasts.toasts.map((t) => t.message)).toEqual(['Read-only access to this project']);
    expect(projects.projects[0]!.members).toEqual([{ user_id: 'u-1', role: 'editor' }]);
  });

  it('rebuilds members on setMembers, keeping the roles it already knows', async () => {
    await loadWith([
      project({
        member_ids: ['u-1', 'u-2'],
        members: [
          { user_id: 'u-1', role: 'viewer' },
          { user_id: 'u-2', role: 'editor' },
        ],
      }),
    ]);
    fetchMock.mockImplementation(async () => jsonResponse(204));

    await projects.setMembers('p-1', ['u-1', 'u-3']);

    expect(projects.projects[0]!.members).toEqual([
      { user_id: 'u-1', role: 'viewer' },
      { user_id: 'u-3', role: 'editor' },
    ]);
    expect(await bodyOf(requestAt(1))).toEqual({ user_ids: ['u-1', 'u-3'] });
  });

  it('stores the role the invite response reports', async () => {
    const added = { id: 'u-2', name: 'Pat', avatar_url: null };
    await loadWith([project({ created_by: 'u-me' })]);
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { status: 'member', role: 'viewer', user: added, invitation: null })
    );

    await projects.addMemberByEmail('p-1', 'pat@example.com');

    expect(projects.projects[0]!.members).toEqual([{ user_id: 'u-2', role: 'viewer' }]);
  });

  it('defaults a fresh project and an unknown realtime project to no members', async () => {
    session.user = me;
    fetchMock.mockImplementation(async (input) =>
      (input as Request).method === 'POST'
        ? jsonResponse(201, boardPayload('p-new', 'New'))
        : jsonResponse(200, { projects: [] })
    );

    const pending = projects.create('New');
    expect(projects.projects[0]!.members).toEqual([]);
    await pending;

    projects.applyRealtime({
      type: 'project_created',
      project_id: 'p-realtime',
      data: { id: 'p-realtime', name: 'Gained' },
    });

    expect(projects.projects.find((p) => p.id === 'p-realtime')!.members).toEqual([]);
  });
});
