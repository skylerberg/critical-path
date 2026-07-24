import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '../helpers/database';
import { newId, uniqueEmail } from '../helpers/fixtures';
import {
  publish,
  subscribeBus,
  resetBus,
  publishAfterCommit,
  type BusEntry,
} from '../../src/services/realtime/bus';
import {
  registerSocket,
  getSocketState,
  subscribeToProject,
  unsubscribeFromProject,
  removeSocket,
  projectSockets,
  socketsForUser,
  resetRealtimeState,
} from '../../src/services/realtime/state';
import { deliver } from '../../src/services/realtime/delivery';
import { closeSocketsForUser } from '../../src/services/realtime/transport';
import type { AppContext } from '../../src/types/index';

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  closes: Array<{ code?: number; reason?: string }> = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
    this.readyState = 3;
  }

  terminate(): void {
    this.readyState = 3;
  }

  events(): Array<{ type: string; project_id: string | null }> {
    return this.sent.map((raw) => JSON.parse(raw));
  }
}

describe('realtime bus', () => {
  beforeEach(() => {
    resetBus();
  });

  it('fans publish out to subscribers until unsubscribed', () => {
    const seen: BusEntry[] = [];
    const unsubscribe = subscribeBus((entry) => seen.push(entry));

    publish({ type: 'task_updated', project_id: 'p1', data: { id: 't1' } });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: 'task_updated', project_id: 'p1' });

    unsubscribe();
    publish({ type: 'task_updated', project_id: 'p1', data: { id: 't1' } });
    expect(seen).toHaveLength(1);
  });

  it('publishAfterCommit publishes only when the hook runs', async () => {
    const seen: BusEntry[] = [];
    subscribeBus((entry) => seen.push(entry));

    const hooks: Array<() => Promise<void>> = [];
    const c = { get: () => hooks } as unknown as Pick<AppContext, 'get'>;

    publishAfterCommit(c, 'project_deleted', 'p1', { id: 'p1' }, { recipientUserIds: ['u1'] });
    expect(hooks).toHaveLength(1);
    expect(seen).toHaveLength(0);

    await hooks[0]();
    expect(seen).toEqual([
      {
        type: 'project_deleted',
        project_id: 'p1',
        data: { id: 'p1' },
        recipientUserIds: ['u1'],
      },
    ]);
  });
});

describe('realtime state', () => {
  beforeEach(() => {
    resetRealtimeState();
  });

  it('tracks registration, rooms, and cleanup', () => {
    const socket = new FakeSocket();
    expect(subscribeToProject(socket, 'p1')).toBe(false);

    registerSocket(socket, 'u1', 's1');
    expect(getSocketState(socket)).toMatchObject({ userId: 'u1', sessionId: 's1' });

    expect(subscribeToProject(socket, 'p1')).toBe(true);
    expect(projectSockets('p1')).toEqual([socket]);
    expect(socketsForUser('u1')).toEqual([socket]);

    unsubscribeFromProject(socket, 'p1');
    expect(projectSockets('p1')).toEqual([]);

    subscribeToProject(socket, 'p2');
    removeSocket(socket);
    expect(projectSockets('p2')).toEqual([]);
    expect(getSocketState(socket)).toBeUndefined();
    expect(socketsForUser('u1')).toEqual([]);
  });
});

describe('realtime delivery', () => {
  const userIds: string[] = [];

  async function createUser(name: string): Promise<string> {
    const id = newId();
    await db
      .insertInto('app_user')
      .values({ id, email: uniqueEmail('rt'), password_hash: 'x', name })
      .execute();
    userIds.push(id);
    return id;
  }

  let creator: string;
  let member: string;
  let outsider: string;
  let personalProjectId: string;
  let sharedProjectId: string;

  beforeAll(async () => {
    creator = await createUser('rt creator');
    member = await createUser('rt member');
    outsider = await createUser('rt outsider');

    personalProjectId = newId();
    sharedProjectId = newId();
    await db
      .insertInto('project')
      .values([
        { id: personalProjectId, name: 'rt personal', created_by: creator },
        { id: sharedProjectId, name: 'rt shared', created_by: creator },
      ])
      .execute();
    await db
      .insertInto('project_member')
      .values({ project_id: sharedProjectId, user_id: member })
      .execute();
  });

  afterAll(async () => {
    await db.deleteFrom('app_user').where('id', 'in', userIds).execute();
  });

  beforeEach(() => {
    resetRealtimeState();
  });

  function connect(userId: string, ...projectIds: string[]): FakeSocket {
    const socket = new FakeSocket();
    registerSocket(socket, userId, newId());
    for (const projectId of projectIds) {
      subscribeToProject(socket, projectId);
    }
    return socket;
  }

  it('sends recipientUserIds events to exactly those users, skipping access checks', async () => {
    const creatorSocket = connect(creator);
    const outsiderSocket = connect(outsider);

    await deliver({
      type: 'project_deleted',
      project_id: personalProjectId,
      data: { id: personalProjectId },
      recipientUserIds: [creator, outsider],
    });

    expect(creatorSocket.events()).toEqual([
      { type: 'project_deleted', project_id: personalProjectId, data: { id: personalProjectId } },
    ]);
    expect(outsiderSocket.events()).toHaveLength(1);
  });

  it('does not send recipientUserIds events to other users', async () => {
    const memberSocket = connect(member);
    await deliver({
      type: 'project_deleted',
      project_id: personalProjectId,
      data: { id: personalProjectId },
      recipientUserIds: [creator],
    });
    expect(memberSocket.sent).toEqual([]);
  });

  it('delivers project events to subscribed sockets whose user has access', async () => {
    const creatorSocket = connect(creator, sharedProjectId);
    const memberSocket = connect(member, sharedProjectId);
    const outsiderSocket = connect(outsider, sharedProjectId);
    const unsubscribedMember = connect(member);

    await deliver({ type: 'task_updated', project_id: sharedProjectId, data: { id: 't1' } });

    expect(creatorSocket.sent).toHaveLength(1);
    expect(memberSocket.sent).toHaveLength(1);
    expect(outsiderSocket.sent).toEqual([]);
    expect(unsubscribedMember.sent).toEqual([]);
  });

  it('denies non-members on a member-less project even when subscribed', async () => {
    const memberSocket = connect(member, personalProjectId);
    const creatorSocket = connect(creator, personalProjectId);

    await deliver({ type: 'task_created', project_id: personalProjectId, data: { id: 't2' } });

    expect(creatorSocket.sent).toHaveLength(1);
    expect(memberSocket.sent).toEqual([]);
  });

  it('broadcast events reach unsubscribed sockets, still access-filtered', async () => {
    const memberSocket = connect(member);
    const outsiderSocket = connect(outsider);

    await deliver({
      type: 'project_updated',
      project_id: sharedProjectId,
      data: { id: sharedProjectId },
      broadcast: true,
    });

    expect(memberSocket.sent).toHaveLength(1);
    expect(outsiderSocket.sent).toEqual([]);
  });

  it('delivers nothing when the project row is gone', async () => {
    const missingProjectId = newId();
    const socket = connect(creator, missingProjectId);
    await deliver({ type: 'task_updated', project_id: missingProjectId, data: { id: 't3' } });
    expect(socket.sent).toEqual([]);
  });

  it('skips sockets that are not open', async () => {
    const socket = connect(creator, personalProjectId);
    socket.readyState = 3;
    await deliver({ type: 'task_updated', project_id: personalProjectId, data: { id: 't4' } });
    expect(socket.sent).toEqual([]);
  });

  it('closeSocketsForUser closes with 4401 and drops state', () => {
    const memberSocket = connect(member, sharedProjectId);
    const creatorSocket = connect(creator, sharedProjectId);

    closeSocketsForUser(member);

    expect(memberSocket.closes).toEqual([{ code: 4401, reason: 'Session revoked' }]);
    expect(getSocketState(memberSocket)).toBeUndefined();
    expect(projectSockets(sharedProjectId)).toEqual([creatorSocket]);
    expect(creatorSocket.closes).toEqual([]);
  });
});
