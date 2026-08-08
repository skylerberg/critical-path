import crypto from 'crypto';
import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Selectable } from 'kysely';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId, rankKey } from '../../helpers/fixtures';
import { waitFor } from '../projects/helpers';
import { settle } from '../realtime/helpers';
import type { WebhookDelivery } from '../../../src/db/types';
import {
  BACKOFF_SECONDS,
  CLAIM_BATCH,
  MAX_ATTEMPTS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_PER_WEBHOOK_PER_TICK,
  claimDueDeliveries,
  pruneDeliveries,
  recordFailure,
  runDueDeliveries,
  type LookupAll,
  type TargetPolicy,
} from '../../../src/services/webhooks/index';

interface ReceivedRequest {
  headers: http.IncomingHttpHeaders;
  body: string;
}

const permissive: TargetPolicy = { allowPrivate: true, requireHttps: false };
const guarded: TargetPolicy = { allowPrivate: false, requireHttps: false };

// An IP-literal URL would leave the custom lookup — and its options.all contract
// — unexercised, because Node skips it entirely for literals.
const stubResolve: LookupAll = () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]);

describe('Webhook delivery', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let user: TestUser;
  let server: http.Server;
  let port: number;
  let received: ReceivedRequest[] = [];
  let responseStatus = 200;
  let redirectTo: string | null = null;
  let counter = 0;

  function receiverUrl(path = '/hook', host = 'webhook-receiver.test'): string {
    counter += 1;
    return `http://${host}:${String(port)}${path}/${String(counter)}`;
  }

  async function createProject(name: string): Promise<{ id: string; columnId: string }> {
    const id = newId();
    const res = await ctx.request(user.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { columns: Array<{ id: string }> };
    projectIds.push(id);
    return { id, columnId: payload.columns[0].id };
  }

  async function registerWebhook(projectId: string, url = receiverUrl()): Promise<string> {
    const id = newId();
    const res = await ctx
      .request(user.token)
      .post('/api/webhooks', { id, project_id: projectId, url });
    expect(res.status).toBe(201);
    return id;
  }

  async function secretOf(webhookId: string): Promise<string> {
    const row = await db
      .selectFrom('project_webhook')
      .select('secret')
      .where('id', '=', webhookId)
      .executeTakeFirstOrThrow();
    return row.secret;
  }

  async function webhookRow(webhookId: string) {
    return db
      .selectFrom('project_webhook')
      .selectAll()
      .where('id', '=', webhookId)
      .executeTakeFirstOrThrow();
  }

  function rows(webhookId: string): Promise<Selectable<WebhookDelivery>[]> {
    return db
      .selectFrom('webhook_delivery')
      .selectAll()
      .where('webhook_id', '=', webhookId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
  }

  function waitForType(webhookId: string, type: string): Promise<void> {
    return waitFor(async () => (await rows(webhookId)).some((r) => r.event_type === type));
  }

  function waitForCount(webhookId: string, count: number): Promise<void> {
    return waitFor(async () => (await rows(webhookId)).length >= count);
  }

  async function forceDue(webhookId: string): Promise<void> {
    await db
      .updateTable('webhook_delivery')
      .set({ next_attempt_at: new Date(Date.now() - 1000) })
      .where('webhook_id', '=', webhookId)
      .where('status', '=', 'pending')
      .execute();
  }

  async function createTask(projectId: string, columnId: string, title: string): Promise<string> {
    const id = newId();
    const res = await ctx.request(user.token).post('/api/tasks', {
      id,
      project_id: projectId,
      column_id: columnId,
      title,
      sort_key: rankKey(1000),
    });
    expect(res.status).toBe(201);
    return id;
  }

  async function seedDelivery(
    webhookId: string,
    overrides: Partial<Selectable<WebhookDelivery>> = {}
  ): Promise<string> {
    const id = newId();
    await db
      .insertInto('webhook_delivery')
      .values({
        id,
        webhook_id: webhookId,
        event_type: 'task_created',
        payload: JSON.stringify({ id, type: 'task_created', data: {} }),
        next_attempt_at: new Date(Date.now() - 1000),
        ...overrides,
      })
      .execute();
    return id;
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
          if (redirectTo !== null) {
            res.writeHead(302, { Location: `http://127.0.0.1:${String(port)}${redirectTo}` });
            res.end();
            return;
          }
          res.writeHead(responseStatus, { 'Content-Type': 'text/plain' });
          res.end(responseStatus === 200 ? 'ok' : 'receiver exploded');
        });
      });
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });

    user = await ctx.createUser('wh-delivery');
  });

  afterEach(async () => {
    if (projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', projectIds).execute();
      projectIds.length = 0;
    }
    received = [];
    responseStatus = 200;
    redirectTo = null;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await ctx.cleanup();
  });

  it('enqueues, signs and delivers a task_created event', async () => {
    const project = await createProject('wh-deliver');
    const webhookId = await registerWebhook(project.id);
    const taskId = await createTask(project.id, project.columnId, 'Ship webhooks');

    await waitForType(webhookId, 'task_created');
    const queued = await rows(webhookId);
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe('pending');

    expect(await runDueDeliveries({ policy: permissive, resolve: stubResolve })).toBe(1);
    expect(received).toHaveLength(1);

    const envelope = JSON.parse(received[0].body) as {
      id: string;
      version: number;
      type: string;
      project_id: string;
      created_at: string;
      data: { id: string; actor_user_id: string | null };
    };
    expect(envelope).toMatchObject({
      id: queued[0].id,
      version: 1,
      type: 'task_created',
      project_id: project.id,
    });
    expect(envelope.data.id).toBe(taskId);
    // The delivered body is the realtime data verbatim, so a board mutation's
    // actor reaches a consumer too. Deliberate, and additive to version 1.
    expect(envelope.data.actor_user_id).toBe(user.id);
    expect(Number.isNaN(Date.parse(envelope.created_at))).toBe(false);

    const headers = received[0].headers;
    expect(headers['x-critical-path-event']).toBe('task_created');
    expect(headers['x-critical-path-delivery']).toBe(queued[0].id);
    expect(headers['x-critical-path-webhook']).toBe(webhookId);
    expect(headers['user-agent']).toBe('CriticalPath-Webhook/1');

    const timestamp = String(headers['x-critical-path-timestamp']);
    const expected = crypto
      .createHmac('sha256', await secretOf(webhookId))
      .update(`${timestamp}.${received[0].body}`)
      .digest('hex');
    expect(headers['x-critical-path-signature']).toBe(`v1=${expected}`);

    const delivered = await rows(webhookId);
    expect(delivered[0].status).toBe('delivered');
    expect(delivered[0].last_status_code).toBe(200);
    expect(delivered[0].next_attempt_at).toBeNull();
  });

  it('connects through the real DNS resolver', async () => {
    const project = await createProject('wh-real-dns');
    const webhookId = await registerWebhook(project.id, receiverUrl('/hook', 'localhost'));
    await createTask(project.id, project.columnId, 'Real lookup');

    await waitForType(webhookId, 'task_created');
    await runDueDeliveries();

    expect(received).toHaveLength(1);
    expect((await rows(webhookId))[0].status).toBe('delivered');
  });

  it('refuses a host that resolves to a blocked address', async () => {
    const project = await createProject('wh-blocked');
    const webhookId = await registerWebhook(project.id);
    await createTask(project.id, project.columnId, 'Blocked');

    await waitForType(webhookId, 'task_created');
    await runDueDeliveries({ policy: guarded, resolve: stubResolve });

    expect(received).toHaveLength(0);
    const [row] = await rows(webhookId);
    expect(row.status).toBe('pending');
    expect(row.last_error).toMatch(/blocked address/);
  });

  it('refuses an IP-literal target that the resolver would never see', async () => {
    const project = await createProject('wh-literal');
    const webhookId = await registerWebhook(project.id, `http://127.0.0.1:${String(port)}/hook`);
    await createTask(project.id, project.columnId, 'Literal');

    await waitForType(webhookId, 'task_created');
    await runDueDeliveries({ policy: guarded, resolve: stubResolve });

    expect(received).toHaveLength(0);
    expect((await rows(webhookId))[0].last_error).toMatch(/private, loopback, or reserved/);
  });

  it('fans one event out to every webhook on the project and no others', async () => {
    const project = await createProject('wh-fanout');
    const other = await createProject('wh-fanout-other');
    const first = await registerWebhook(project.id);
    const second = await registerWebhook(project.id);
    const foreign = await registerWebhook(other.id);

    await createTask(project.id, project.columnId, 'Fan out');

    await waitForType(first, 'task_created');
    await waitForType(second, 'task_created');
    await settle();
    expect(await rows(foreign)).toHaveLength(0);

    await runDueDeliveries({ policy: permissive, resolve: stubResolve });
    expect(received).toHaveLength(2);
  });

  it('enqueues nothing for a disabled webhook', async () => {
    const project = await createProject('wh-disabled');
    const active = await registerWebhook(project.id);
    const disabled = await registerWebhook(project.id);
    await db
      .updateTable('project_webhook')
      .set({ disabled_at: new Date() })
      .where('id', '=', disabled)
      .execute();

    await createTask(project.id, project.columnId, 'Only the active one');
    await ctx.request(user.token).patch(`/api/projects/${project.id}`, { name: 'renamed' });

    await waitForType(active, 'project_updated');
    await settle();
    expect(await rows(disabled)).toHaveLength(0);
  });

  it('covers comments, archive and restore, and publishing a board', async () => {
    const project = await createProject('wh-catalog');
    const webhookId = await registerWebhook(project.id);
    const taskId = await createTask(project.id, project.columnId, 'Catalog');

    expect(
      (
        await ctx.request(user.token).post('/api/comments', {
          id: newId(),
          task_id: taskId,
          body: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
          },
        })
      ).status
    ).toBe(201);
    expect((await ctx.request(user.token).post(`/api/tasks/${taskId}/archive`)).status).toBe(200);
    expect((await ctx.request(user.token).post(`/api/tasks/${taskId}/restore`)).status).toBe(200);
    expect(
      (await ctx.request(user.token).patch(`/api/projects/${project.id}`, { is_public: true }))
        .status
    ).toBe(200);

    await waitForCount(webhookId, 5);
    await settle();
    expect((await rows(webhookId)).map((r) => r.event_type)).toEqual([
      'task_created',
      'comment_created',
      'task_archived',
      'task_restored',
      'project_updated',
    ]);
  });

  it('never enqueues an excluded event type', async () => {
    const project = await createProject('wh-excluded');
    const webhookId = await registerWebhook(project.id);

    expect(
      (
        await ctx
          .request(user.token)
          .put(`/api/projects/${project.id}/position`, { sort_key: rankKey(5000) })
      ).status
    ).toBe(204);
    expect(
      (await ctx.request(user.token).patch('/api/auth/me', { name: 'Renamed User' })).status
    ).toBe(200);
    await ctx.request(user.token).patch(`/api/projects/${project.id}`, { name: 'sentinel' });

    await waitForType(webhookId, 'project_updated');
    await settle();
    const types = (await rows(webhookId)).map((r) => r.event_type);
    expect(types).toEqual(['project_updated']);
  });

  it('enqueues the member-removal fan-out but not the eviction event', async () => {
    const member = await ctx.createUser('wh-member');
    const project = await createProject('wh-members');
    expect(
      (
        await ctx
          .request(user.token)
          .put(`/api/projects/${project.id}/members`, { user_ids: [member.id] })
      ).status
    ).toBe(204);
    const taskId = await createTask(project.id, project.columnId, 'Assigned');
    expect(
      (
        await ctx
          .request(user.token)
          .put(`/api/tasks/${taskId}/assignees`, { user_ids: [member.id] })
      ).status
    ).toBe(204);

    const webhookId = await registerWebhook(project.id);
    expect(
      (await ctx.request(user.token).put(`/api/projects/${project.id}/members`, { user_ids: [] }))
        .status
    ).toBe(204);

    await waitForType(webhookId, 'task_relations_set');
    await waitForType(webhookId, 'project_updated');
    await settle();
    const types = (await rows(webhookId)).map((r) => r.event_type).sort();
    expect(types).toEqual(['project_updated', 'task_relations_set']);
  });

  it('retries a failing receiver on the backoff schedule and exhausts into failed', async () => {
    const project = await createProject('wh-retry');
    const webhookId = await registerWebhook(project.id);
    await createTask(project.id, project.columnId, 'Doomed');
    await waitForType(webhookId, 'task_created');
    responseStatus = 500;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await forceDue(webhookId);
      await runDueDeliveries({ policy: permissive, resolve: stubResolve });
      const [row] = await rows(webhookId);
      expect(row.attempt_count).toBe(attempt);
      expect(row.last_status_code).toBe(500);
      expect(row.last_error).toMatch(/receiver exploded/);
      if (attempt < MAX_ATTEMPTS) {
        expect(row.status).toBe('pending');
        const delaySeconds =
          (row.next_attempt_at!.getTime() - row.last_attempt_at!.getTime()) / 1000;
        expect(delaySeconds).toBeCloseTo(
          BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)],
          0
        );
      } else {
        expect(row.status).toBe('failed');
        expect(row.next_attempt_at).toBeNull();
      }
    }

    expect(received).toHaveLength(MAX_ATTEMPTS);
    expect((await webhookRow(webhookId)).consecutive_failures).toBe(1);
  });

  it('auto-disables after consecutive exhausted deliveries and terminates the backlog', async () => {
    const project = await createProject('wh-autodisable');
    const webhookId = await registerWebhook(project.id);
    await db
      .updateTable('project_webhook')
      .set({ consecutive_failures: MAX_CONSECUTIVE_FAILURES - 1 })
      .where('id', '=', webhookId)
      .execute();
    const doomed = await seedDelivery(webhookId, { attempt_count: MAX_ATTEMPTS - 1 });
    const backlog = await seedDelivery(webhookId, {
      next_attempt_at: new Date(Date.now() + 60_000),
    });
    responseStatus = 500;

    await runDueDeliveries({ policy: permissive, resolve: stubResolve });

    const webhook = await webhookRow(webhookId);
    expect(webhook.consecutive_failures).toBe(MAX_CONSECUTIVE_FAILURES);
    expect(webhook.disabled_at).not.toBeNull();

    const all = await rows(webhookId);
    expect(all.find((r) => r.id === doomed)?.status).toBe('failed');
    const stranded = all.find((r) => r.id === backlog);
    expect(stranded?.status).toBe('failed');
    expect(stranded?.next_attempt_at).toBeNull();
    expect(stranded?.last_error).toBe('Webhook disabled after repeated failures');
  });

  it('abandons the rest of a claimed group when auto-disable trips mid-batch', async () => {
    const project = await createProject('wh-autodisable-group');
    const webhookId = await registerWebhook(project.id);
    await db
      .updateTable('project_webhook')
      .set({ consecutive_failures: MAX_CONSECUTIVE_FAILURES - 1 })
      .where('id', '=', webhookId)
      .execute();
    const doomed = await seedDelivery(webhookId, {
      attempt_count: MAX_ATTEMPTS - 1,
      created_at: new Date(Date.now() - 60_000),
    });
    const siblings: string[] = [];
    for (let i = 0; i < MAX_PER_WEBHOOK_PER_TICK - 1; i++) {
      siblings.push(await seedDelivery(webhookId));
    }
    responseStatus = 500;

    await runDueDeliveries({ policy: permissive, resolve: stubResolve });

    expect((await webhookRow(webhookId)).disabled_at).not.toBeNull();
    expect(received).toHaveLength(1);

    const all = await rows(webhookId);
    expect(all.find((r) => r.id === doomed)?.status).toBe('failed');
    for (const id of siblings) {
      const row = all.find((r) => r.id === id);
      expect(row?.status).toBe('failed');
      expect(row?.next_attempt_at).toBeNull();
    }
    expect(await claimDueDeliveries(CLAIM_BATCH)).toHaveLength(0);
  });

  it('does not put an in-flight delivery back to pending after a manual disable', async () => {
    const project = await createProject('wh-disable-inflight');
    const webhookId = await registerWebhook(project.id);
    const deliveryId = await seedDelivery(webhookId);

    const [claimed] = await claimDueDeliveries(CLAIM_BATCH);
    expect(claimed.id).toBe(deliveryId);

    expect(
      (
        await ctx
          .request(user.token)
          .patch(`/api/webhooks/${webhookId}`, { disabled_at: new Date().toISOString() })
      ).status
    ).toBe(200);

    await recordFailure(claimed, { statusCode: 500, error: 'Receiver responded 500' });

    const [row] = await rows(webhookId);
    expect(row.status).toBe('failed');
    expect(row.next_attempt_at).toBeNull();
  });

  it('never follows a redirect', async () => {
    const project = await createProject('wh-redirect');
    const webhookId = await registerWebhook(project.id);
    await seedDelivery(webhookId);
    redirectTo = '/redirected';

    await runDueDeliveries({ policy: permissive, resolve: stubResolve });

    expect(received).toHaveLength(1);
    const [row] = await rows(webhookId);
    expect(row.status).toBe('pending');
    expect(row.last_status_code).toBe(302);
  });

  it('clears the failure count on the next success', async () => {
    const project = await createProject('wh-recover');
    const webhookId = await registerWebhook(project.id);
    await db
      .updateTable('project_webhook')
      .set({ consecutive_failures: 3 })
      .where('id', '=', webhookId)
      .execute();
    await seedDelivery(webhookId);

    await runDueDeliveries({ policy: permissive, resolve: stubResolve });

    expect((await webhookRow(webhookId)).consecutive_failures).toBe(0);
  });

  it('re-sends a failed delivery under its original id without arming auto-disable', async () => {
    const project = await createProject('wh-redeliver');
    const webhookId = await registerWebhook(project.id);
    const deliveryId = await seedDelivery(webhookId, {
      status: 'failed',
      attempt_count: MAX_ATTEMPTS,
      next_attempt_at: null,
      last_error: 'Receiver responded 500',
      last_status_code: 500,
    });
    await db
      .updateTable('project_webhook')
      .set({ consecutive_failures: 1 })
      .where('id', '=', webhookId)
      .execute();

    expect(
      (
        await ctx
          .request(user.token)
          .post(`/api/webhooks/${webhookId}/deliveries/${deliveryId}/redeliver`)
      ).status
    ).toBe(204);

    const queued = (await rows(webhookId))[0];
    expect(queued).toMatchObject({
      status: 'pending',
      attempt_count: 0,
      redelivery_count: 1,
      last_error: null,
      last_status_code: null,
    });

    responseStatus = 500;
    await forceDue(webhookId);
    await runDueDeliveries({ policy: permissive, resolve: stubResolve });
    expect(received).toHaveLength(1);
    expect(received[0].headers['x-critical-path-delivery']).toBe(deliveryId);

    const retried = (await rows(webhookId))[0];
    expect(retried.status).toBe('pending');
    expect(retried.attempt_count).toBe(1);

    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      await forceDue(webhookId);
      await runDueDeliveries({ policy: permissive, resolve: stubResolve });
    }

    const exhausted = (await rows(webhookId))[0];
    expect(exhausted.status).toBe('failed');
    expect((await webhookRow(webhookId)).consecutive_failures).toBe(1);
  });

  it('serves the delivery log newest first, honoring limit and carrying the payload', async () => {
    const project = await createProject('wh-log');
    const webhookId = await registerWebhook(project.id);
    const older = await seedDelivery(webhookId, {
      event_type: 'task_created',
      created_at: new Date(Date.now() - 60_000),
    });
    const newer = await seedDelivery(webhookId, {
      event_type: 'task_updated',
      created_at: new Date(),
    });

    const res = await ctx.request(user.token).get(`/api/webhooks/${webhookId}/deliveries`);
    expect(res.status).toBe(200);
    const { deliveries } = (await res.json()) as {
      deliveries: Array<{ id: string; event_type: string; payload: { id: string } }>;
    };
    expect(deliveries.map((d) => d.id)).toEqual([newer, older]);
    expect(deliveries[0].payload.id).toBe(newer);

    const limited = await ctx
      .request(user.token)
      .get(`/api/webhooks/${webhookId}/deliveries?limit=1`);
    const one = (await limited.json()) as { deliveries: Array<{ id: string }> };
    expect(one.deliveries.map((d) => d.id)).toEqual([newer]);
  });

  it('leases a claimed row so a second claim cannot re-serve it', async () => {
    const project = await createProject('wh-lease');
    const webhookId = await registerWebhook(project.id);
    await seedDelivery(webhookId);

    const first = await claimDueDeliveries(CLAIM_BATCH);
    expect(first.map((r) => r.webhook_id)).toEqual([webhookId]);

    const second = await claimDueDeliveries(CLAIM_BATCH);
    expect(second.filter((r) => r.webhook_id === webhookId)).toHaveLength(0);
  });

  it('caps how much of one batch a single webhook can take', async () => {
    const project = await createProject('wh-fairness');
    const busy = await registerWebhook(project.id);
    const quiet = await registerWebhook(project.id);
    for (let i = 0; i < 8; i++) {
      await seedDelivery(busy);
    }
    await seedDelivery(quiet);

    const claimed = await claimDueDeliveries(CLAIM_BATCH);
    expect(claimed.filter((r) => r.webhook_id === busy).length).toBeLessThanOrEqual(
      MAX_PER_WEBHOOK_PER_TICK
    );
    expect(claimed.filter((r) => r.webhook_id === quiet)).toHaveLength(1);
  });

  it('prunes terminal deliveries past the retention window and keeps live retries', async () => {
    const project = await createProject('wh-prune');
    const webhookId = await registerWebhook(project.id);
    const stale = await seedDelivery(webhookId, {
      status: 'delivered',
      next_attempt_at: null,
      created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const recentTerminal = await seedDelivery(webhookId, {
      status: 'failed',
      next_attempt_at: null,
    });
    const live = await seedDelivery(webhookId, {
      created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });

    await pruneDeliveries();

    const remaining = (await rows(webhookId)).map((r) => r.id).sort();
    expect(remaining).toEqual([recentTerminal, live].sort());
    expect(remaining).not.toContain(stale);
  });
});
