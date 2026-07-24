import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaces, type Workspace } from './workspaces.svelte';
import { projects, type Project } from './projects.svelte';
import { session } from './session.svelte';
import { users } from './users.svelte';
import { toasts } from './toasts.svelte';

const me = { id: 'u-me', email: 'me@example.com', name: 'Me' };

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'w-1',
    name: 'Alpha',
    created_by: me.id,
    created_at: '2026-01-01T00:00:00.000Z',
    member_ids: [me.id],
    ...overrides,
  };
}

async function bodyOf(request: Request): Promise<unknown> {
  return request.clone().json();
}

async function loadWith(items: Workspace[]): Promise<void> {
  fetchMock.mockImplementationOnce(async () => jsonResponse(200, { workspaces: items }));
  await workspaces.load();
}

beforeEach(() => {
  fetchMock.mockReset();
  workspaces.reset();
  projects.reset();
  users.reset();
  session.user = me;
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
});

describe('workspaces store', () => {
  it('loads once and sorts by name', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        workspaces: [
          workspace({ id: 'w-2', name: 'Zed' }),
          workspace({ id: 'w-1', name: 'Alpha' }),
        ],
      })
    );

    await workspaces.load();
    await workspaces.load();

    expect(new URL(requestAt(0).url).pathname).toBe('/api/workspaces');
    expect(workspaces.workspaces.map((w) => w.name)).toEqual(['Alpha', 'Zed']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('looks up a workspace by id', async () => {
    await loadWith([workspace({ id: 'w-9', name: 'Nine' })]);
    expect(workspaces.byId('w-9')?.name).toBe('Nine');
    expect(workspaces.byId('missing')).toBeUndefined();
  });

  it('creates optimistically with the creator as a member and reconciles', async () => {
    const created = workspace({ id: 'ignored-server-id', name: 'New', member_ids: [me.id] });
    fetchMock.mockImplementation(async (input) => {
      const body = (await (input as Request).clone().json()) as { id: string; name: string };
      return jsonResponse(201, { ...created, id: body.id });
    });

    const pending = workspaces.create('New');
    expect(workspaces.workspaces).toHaveLength(1);
    expect(workspaces.workspaces[0]!.member_ids).toEqual([me.id]);

    const id = await pending;

    expect(id).not.toBeNull();
    expect(requestAt(0).method).toBe('POST');
    const body = (await bodyOf(requestAt(0))) as { id: string; name: string };
    expect(body.name).toBe('New');
    expect(body.id).toBe(id);
    expect(workspaces.byId(id!)?.name).toBe('New');
  });

  it('refetches when create fails', async () => {
    const existing = workspace({ id: 'w-keep', name: 'Keep' });
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'POST') {
        return jsonResponse(422, { error: 'bad name' });
      }
      return jsonResponse(200, { workspaces: [existing] });
    });

    const id = await workspaces.create('Doomed');

    expect(id).toBeNull();
    expect(toasts.toasts.map((t) => t.message)).toEqual(['bad name']);
    expect(workspaces.workspaces).toEqual([existing]);
  });

  it('renames optimistically and PATCHes', async () => {
    await loadWith([workspace({ id: 'w-1', name: 'Old' })]);
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, workspace({ id: 'w-1', name: 'New' }))
    );

    const pending = workspaces.rename('w-1', 'New');
    expect(workspaces.byId('w-1')?.name).toBe('New');

    await pending;

    expect(requestAt(1).method).toBe('PATCH');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/workspaces/w-1');
    expect(await bodyOf(requestAt(1))).toEqual({ name: 'New' });
  });

  it('deletes optimistically and reverts its projects to personal', async () => {
    await loadWith([workspace({ id: 'w-1' })]);
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(200, {
        projects: [
          {
            id: 'p-1',
            name: 'P',
            description: '',
            archived_at: null,
            created_by: me.id,
            workspace_id: 'w-1',
            created_at: '2026-01-01T00:00:00.000Z',
            open_task_count: 0,
            done_task_count: 0,
          },
        ],
      })
    );
    await projects.load();
    fetchMock.mockImplementation(async () => jsonResponse(204));

    const pending = workspaces.remove('w-1');
    expect(workspaces.workspaces).toEqual([]);
    expect(projects.projects[0]!.workspace_id).toBeNull();

    await pending;

    const del = requestAt(2);
    expect(del.method).toBe('DELETE');
    expect(new URL(del.url).pathname).toBe('/api/workspaces/w-1');
  });

  it('sets members with a PUT and refetches on failure', async () => {
    await loadWith([workspace({ id: 'w-1', member_ids: [me.id, 'u-2'] })]);
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'PUT') {
        return jsonResponse(422, { error: 'cannot remove yourself' });
      }
      return jsonResponse(200, {
        workspaces: [workspace({ id: 'w-1', member_ids: [me.id, 'u-2'] })],
      });
    });

    const pending = workspaces.setMembers('w-1', [me.id]);
    expect(workspaces.byId('w-1')?.member_ids).toEqual([me.id]);

    await pending;

    expect(await bodyOf(requestAt(1))).toEqual({ user_ids: [me.id] });
    expect(toasts.toasts.map((t) => t.message)).toEqual(['cannot remove yourself']);
    expect(workspaces.byId('w-1')?.member_ids).toEqual([me.id, 'u-2']);
  });

  it('adds a member by email and records the returned user', async () => {
    await loadWith([workspace({ id: 'w-1', member_ids: [me.id] })]);
    const added = { id: 'u-new', email: 'new@example.com', name: 'New Person' };
    fetchMock.mockImplementation(async () => jsonResponse(200, { user: added }));

    const result = await workspaces.addMemberByEmail('w-1', 'new@example.com');

    expect(result).toEqual({ ok: true });
    expect(new URL(requestAt(1).url).pathname).toBe('/api/workspaces/w-1/members/by-email');
    expect(await bodyOf(requestAt(1))).toEqual({ email: 'new@example.com' });
    expect(workspaces.byId('w-1')?.member_ids).toEqual([me.id, 'u-new']);
    expect(users.byId('u-new')).toEqual(added);
  });

  it('returns a friendly error when the email is unknown', async () => {
    await loadWith([workspace({ id: 'w-1', member_ids: [me.id] })]);
    fetchMock.mockImplementation(async () => jsonResponse(404, { error: 'not found' }));

    const result = await workspaces.addMemberByEmail('w-1', 'nobody@example.com');

    expect(result).toEqual({ ok: false, error: 'No user with that email' });
    expect(workspaces.byId('w-1')?.member_ids).toEqual([me.id]);
  });

  it('invalidates the project-scoped user cache after adding a member so pickers refetch', async () => {
    await loadWith([workspace({ id: 'w-1', member_ids: [me.id] })]);
    fetchMock.mockImplementationOnce(async () => jsonResponse(200, { users: [me] }));
    await users.loadForProject('p-1');
    expect(users.forProject('p-1').map((u) => u.id)).toEqual([me.id]);

    const bob = { id: 'u-bob', email: 'bob@example.com', name: 'Bob' };
    fetchMock.mockImplementationOnce(async () => jsonResponse(200, { user: bob }));
    expect(await workspaces.addMemberByEmail('w-1', 'bob@example.com')).toEqual({ ok: true });

    fetchMock.mockImplementationOnce(async () => jsonResponse(200, { users: [me, bob] }));
    await users.loadForProject('p-1');
    expect(users.forProject('p-1').map((u) => u.id)).toContain('u-bob');
  });

  it('reset clears the list and allows a fresh load', async () => {
    await loadWith([workspace()]);
    workspaces.reset();
    expect(workspaces.workspaces).toEqual([]);

    fetchMock.mockImplementation(async () => jsonResponse(200, { workspaces: [] }));
    await workspaces.load();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('workspaces realtime projects reconciliation', () => {
  function projectItem(id: string, workspaceId: string | null): Project {
    return {
      id,
      name: id,
      description: '',
      archived_at: null,
      created_by: 'someone-else',
      workspace_id: workspaceId,
      created_at: '2026-01-01T00:00:00.000Z',
      open_task_count: 0,
      done_task_count: 0,
    };
  }

  it('resyncs projects when a members_set removes the caller', async () => {
    workspaces.workspaces = [workspace({ id: 'w-1', member_ids: [me.id] })];
    projects.projects = [projectItem('p-ghost', 'w-1')];
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [] }));

    workspaces.applyRealtime({
      type: 'workspace_members_set',
      project_id: null,
      data: workspace({ id: 'w-1', member_ids: ['someone-else'] }),
    });

    expect(workspaces.workspaces).toEqual([]);
    await vi.waitFor(() => expect(projects.projects).toEqual([]));
  });

  it('resyncs projects when the workspace is deleted', async () => {
    workspaces.workspaces = [workspace({ id: 'w-1', member_ids: [me.id] })];
    projects.projects = [projectItem('p-ghost', 'w-1')];
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [] }));

    workspaces.applyRealtime({ type: 'workspace_deleted', project_id: null, data: { id: 'w-1' } });

    expect(workspaces.workspaces).toEqual([]);
    await vi.waitFor(() => expect(projects.projects).toEqual([]));
  });

  it('loads projects when a members_set adds the caller to a newly gained workspace', async () => {
    workspaces.workspaces = [];
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { projects: [projectItem('p-new', 'w-new')] })
    );

    workspaces.applyRealtime({
      type: 'workspace_members_set',
      project_id: null,
      data: workspace({ id: 'w-new', member_ids: [me.id] }),
    });

    expect(workspaces.byId('w-new')).toBeDefined();
    await vi.waitFor(() => expect(projects.projects.map((p) => p.id)).toContain('p-new'));
  });

  it('does not refetch projects when a members_set only tweaks a workspace the caller keeps', async () => {
    workspaces.workspaces = [workspace({ id: 'w-1', member_ids: [me.id] })];
    fetchMock.mockClear();

    workspaces.applyRealtime({
      type: 'workspace_members_set',
      project_id: null,
      data: workspace({ id: 'w-1', member_ids: [me.id, 'u-2'] }),
    });

    await Promise.resolve();
    expect(workspaces.byId('w-1')?.member_ids).toEqual([me.id, 'u-2']);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
