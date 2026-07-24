import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import WebSocket from 'ws';
import { app } from '../../../src/index';
import { attachRealtime, projectSockets } from '../../../src/services/realtime/index';
import type { RealtimeHandle } from '../../../src/services/realtime/index';
import { TestContext, type TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { deleteProjects, waitFor } from '../projects/helpers';

interface ListedProject {
  id: string;
  position: number | null;
}

async function positionRow(
  userId: string,
  projectId: string
): Promise<{ position: number } | undefined> {
  return await db
    .selectFrom('project_user_position')
    .select('position')
    .where('user_id', '=', userId)
    .where('project_id', '=', projectId)
    .executeTakeFirst();
}

describe('project positions', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let userA: TestUser;
  let userB: TestUser;
  let first: string;
  let second: string;
  let third: string;

  async function createProject(user: TestUser, name: string, createdAt: string): Promise<string> {
    const id = newId();
    const res = await ctx.request(user.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    projectIds.push(id);
    await db.updateTable('project').set({ created_at: createdAt }).where('id', '=', id).execute();
    return id;
  }

  async function listProjects(user: TestUser): Promise<ListedProject[]> {
    const res = await ctx.request(user.token).get('/api/projects');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: ListedProject[] };
    return body.projects;
  }

  beforeAll(async () => {
    userA = await ctx.createUser('positions-a');
    userB = await ctx.createUser('positions-b');

    first = await createProject(userA, 'First', '2026-01-01T00:00:01.000Z');
    second = await createProject(userA, 'Second', '2026-01-01T00:00:02.000Z');
    third = await createProject(userA, 'Third', '2026-01-01T00:00:03.000Z');

    const shareRes = await ctx
      .request(userA.token)
      .put(`/api/projects/${first}/members`, { user_ids: [userB.id] });
    expect(shareRes.status).toBe(204);
  });

  afterAll(async () => {
    await deleteProjects(projectIds);
    await ctx.cleanup();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await ctx.request().put(`/api/projects/${first}/position`, { position: 1000 });
    expect(res.status).toBe(401);
  });

  it('lists null positions in created_at order before any positioning', async () => {
    const projects = await listProjects(userA);
    expect(projects.map((p) => p.id)).toEqual([first, second, third]);
    expect(projects.map((p) => p.position)).toEqual([null, null, null]);
  });

  it('sets a position and orders that project before null positions', async () => {
    const res = await ctx
      .request(userA.token)
      .put(`/api/projects/${third}/position`, { position: 1000 });
    expect(res.status).toBe(204);

    const projects = await listProjects(userA);
    expect(projects.map((p) => p.id)).toEqual([third, first, second]);
    expect(projects.map((p) => p.position)).toEqual([1000, null, null]);
  });

  it('orders multiple positioned projects by position', async () => {
    const res = await ctx
      .request(userA.token)
      .put(`/api/projects/${first}/position`, { position: 500 });
    expect(res.status).toBe(204);

    const projects = await listProjects(userA);
    expect(projects.map((p) => p.id)).toEqual([first, third, second]);
    expect(projects.map((p) => p.position)).toEqual([500, 1000, null]);
  });

  it('upserts on a repeat PUT for the same project', async () => {
    const res = await ctx
      .request(userA.token)
      .put(`/api/projects/${third}/position`, { position: 250 });
    expect(res.status).toBe(204);

    const projects = await listProjects(userA);
    expect(projects.map((p) => p.id)).toEqual([third, first, second]);
    expect(projects.map((p) => p.position)).toEqual([250, 500, null]);

    const rows = await db
      .selectFrom('project_user_position')
      .select('position')
      .where('user_id', '=', userA.id)
      .where('project_id', '=', third)
      .execute();
    expect(rows).toEqual([{ position: 250 }]);
  });

  it('keeps positions isolated per user', async () => {
    const before = await listProjects(userB);
    expect(before.map((p) => ({ id: p.id, position: p.position }))).toEqual([
      { id: first, position: null },
    ]);

    const res = await ctx
      .request(userB.token)
      .put(`/api/projects/${first}/position`, { position: 9999 });
    expect(res.status).toBe(204);

    const bProjects = await listProjects(userB);
    expect(bProjects.map((p) => ({ id: p.id, position: p.position }))).toEqual([
      { id: first, position: 9999 },
    ]);

    const aProjects = await listProjects(userA);
    expect(aProjects.map((p) => p.id)).toEqual([third, first, second]);
    expect(aProjects.map((p) => p.position)).toEqual([250, 500, null]);
  });

  it('returns 404 for a project the caller cannot access', async () => {
    const res = await ctx
      .request(userB.token)
      .put(`/api/projects/${second}/position`, { position: 1 });
    expect(res.status).toBe(404);
    expect(await positionRow(userB.id, second)).toBeUndefined();
  });

  it('returns 404 for an unknown project', async () => {
    const res = await ctx.request(userA.token).put(`/api/projects/${newId()}/position`, {
      position: 1,
    });
    expect(res.status).toBe(404);
  });

  it('returns 422 when position is missing', async () => {
    const res = await ctx.request(userA.token).put(`/api/projects/${first}/position`, {});
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('returns 422 when position is not a number', async () => {
    const res = await ctx
      .request(userA.token)
      .put(`/api/projects/${first}/position`, { position: 'top' });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Validation failed');
  });

  it('returns 422 when position is not finite', async () => {
    for (const literal of ['1e999', '-1e999']) {
      const res = await ctx
        .request(userA.token)
        .sendRawJson('PUT', `/api/projects/${first}/position`, `{"position":${literal}}`);
      expect(res.status, literal).toBe(422);
      expect((await res.json()).error).toBe('Validation failed');
    }
  });

  it('deletes position rows when the project is deleted', async () => {
    const doomed = await createProject(userA, 'Doomed', '2026-01-01T00:00:04.000Z');
    const putRes = await ctx
      .request(userA.token)
      .put(`/api/projects/${doomed}/position`, { position: 42 });
    expect(putRes.status).toBe(204);
    expect(await positionRow(userA.id, doomed)).toEqual({ position: 42 });

    const deleteRes = await ctx.request(userA.token).delete(`/api/projects/${doomed}`);
    expect(deleteRes.status).toBe(204);
    expect(await positionRow(userA.id, doomed)).toBeUndefined();
  });
});

interface Envelope {
  type: string;
  project_id: string | null;
  data: Record<string, unknown>;
}

class RtClient {
  readonly events: Envelope[] = [];

  private constructor(private ws: WebSocket) {}

  static connect(port: number, token: string): Promise<RtClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const client = new RtClient(ws);
      ws.on('error', reject);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('message', (raw) => {
        const message = JSON.parse(String(raw)) as Envelope;
        if (message.type === 'auth_ok') {
          resolve(client);
          return;
        }
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        client.events.push(message);
      });
    });
  }

  subscribe(projectId: string): void {
    this.ws.send(JSON.stringify({ type: 'subscribe', project_id: projectId }));
  }

  async waitForEvent(predicate: (event: Envelope) => boolean, timeoutMs = 4000): Promise<Envelope> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = this.events.find(predicate);
      if (match) return match;
      if (Date.now() > deadline) {
        const seen = this.events.map((event) => event.type).join(', ') || 'none';
        throw new Error(`No matching event before timeout; saw: ${seen}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  eventsOfType(type: string): Envelope[] {
    return this.events.filter((event) => event.type === type);
  }

  close(): void {
    this.ws.close();
  }
}

// Delivery runs in unawaited post-commit hooks, so silence can only be
// asserted after giving in-flight deliveries time to land.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200));
}

describe('project position realtime', () => {
  const ctx = new TestContext();
  let server: ServerType;
  let realtime: RealtimeHandle;
  let port: number;

  let userA: TestUser;
  let userB: TestUser;
  let clientA1: RtClient;
  let clientA2: RtClient;
  let clientB: RtClient;
  const clients: RtClient[] = [];

  let projectId: string;

  async function connect(token: string): Promise<RtClient> {
    const client = await RtClient.connect(port, token);
    clients.push(client);
    return client;
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        port = info.port;
        resolve();
      });
    });
    realtime = attachRealtime(server);

    userA = await ctx.createUser('positions-rt-a');
    userB = await ctx.createUser('positions-rt-b');

    projectId = newId();
    const projectRes = await ctx
      .request(userA.token)
      .post('/api/projects', { id: projectId, name: 'positions rt project' });
    expect(projectRes.status).toBe(201);
    const shareRes = await ctx
      .request(userA.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [userB.id] });
    expect(shareRes.status).toBe(204);

    clientA1 = await connect(userA.token);
    clientA2 = await connect(userA.token);
    clientB = await connect(userB.token);

    clientA1.subscribe(projectId);
    clientB.subscribe(projectId);
    await waitFor(async () => projectSockets(projectId).length === 2);
  });

  afterAll(async () => {
    for (const client of clients) {
      client.close();
    }
    realtime.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await deleteProjects([projectId]);
    await ctx.cleanup();
  });

  it('delivers project_position_updated to every socket of the caller and nobody else', async () => {
    const res = await ctx
      .request(userA.token)
      .put(`/api/projects/${projectId}/position`, { position: 1500 });
    expect(res.status).toBe(204);

    const event = await clientA1.waitForEvent(
      (e) => e.type === 'project_position_updated' && e.data.id === projectId
    );
    expect(event).toEqual({
      type: 'project_position_updated',
      project_id: projectId,
      data: { id: projectId, position: 1500 },
    });
    await clientA2.waitForEvent(
      (e) => e.type === 'project_position_updated' && e.data.id === projectId
    );

    await settle();
    expect(clientB.eventsOfType('project_position_updated')).toEqual([]);
  });
});
