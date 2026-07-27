import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';

interface WebhookBody {
  id: string;
  project_id: string;
  url: string;
  secret: string;
  disabled_at: string | null;
  consecutive_failures: number;
  created_at: string;
}

describe('Webhooks API', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let user: TestUser;
  let outsider: TestUser;
  let counter = 0;

  async function createProject(name: string): Promise<string> {
    const id = newId();
    await db.insertInto('project').values({ id, name, created_by: user.id }).execute();
    projectIds.push(id);
    return id;
  }

  function uniqueUrl(): string {
    counter += 1;
    return `https://receiver.example.com/hook/${String(counter)}`;
  }

  async function createWebhook(projectId: string, url = uniqueUrl()): Promise<WebhookBody> {
    const res = await ctx
      .request(user.token)
      .post('/api/webhooks', { id: newId(), project_id: projectId, url });
    expect(res.status).toBe(201);
    return (await res.json()) as WebhookBody;
  }

  async function insertPendingDelivery(webhookId: string): Promise<string> {
    const id = newId();
    await db
      .insertInto('webhook_delivery')
      .values({
        id,
        webhook_id: webhookId,
        event_type: 'task_created',
        payload: JSON.stringify({ id, type: 'task_created' }),
        next_attempt_at: new Date(Date.now() - 60_000),
      })
      .execute();
    return id;
  }

  beforeAll(async () => {
    user = await ctx.createUser('webhooks');
    outsider = await ctx.createUser('webhooks-outsider');
  });

  afterAll(async () => {
    if (projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', projectIds).execute();
    }
    await ctx.cleanup();
  });

  it('requires auth on every route', async () => {
    const anon = ctx.request();
    const id = newId();
    expect(
      (await anon.post('/api/webhooks', { id, project_id: id, url: 'https://a.example' })).status
    ).toBe(401);
    expect((await anon.get(`/api/webhooks?project_id=${id}`)).status).toBe(401);
    expect((await anon.patch(`/api/webhooks/${id}`, { url: 'https://a.example' })).status).toBe(
      401
    );
    expect((await anon.delete(`/api/webhooks/${id}`)).status).toBe(401);
    expect((await anon.post(`/api/webhooks/${id}/rotate-secret`)).status).toBe(401);
    expect((await anon.get(`/api/webhooks/${id}/deliveries`)).status).toBe(401);
    expect((await anon.post(`/api/webhooks/${id}/deliveries/${id}/redeliver`)).status).toBe(401);
  });

  describe('POST /api/webhooks', () => {
    it('registers a webhook with a generated secret', async () => {
      const projectId = await createProject('wh-create');
      const url = uniqueUrl();
      const id = newId();

      const res = await ctx
        .request(user.token)
        .post('/api/webhooks', { id, project_id: projectId, url });
      expect(res.status).toBe(201);
      const body = (await res.json()) as WebhookBody;
      expect(body).toMatchObject({
        id,
        project_id: projectId,
        url,
        disabled_at: null,
        consecutive_failures: 0,
      });
      expect(body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('rejects a duplicate id and a duplicate url in the same project, but not across projects', async () => {
      const projectId = await createProject('wh-dupes');
      const otherProjectId = await createProject('wh-dupes-other');
      const webhook = await createWebhook(projectId);

      const sameId = await ctx
        .request(user.token)
        .post('/api/webhooks', { id: webhook.id, project_id: projectId, url: uniqueUrl() });
      expect(sameId.status).toBe(409);

      const sameUrl = await ctx
        .request(user.token)
        .post('/api/webhooks', { id: newId(), project_id: projectId, url: webhook.url });
      expect(sameUrl.status).toBe(409);

      const otherProject = await ctx
        .request(user.token)
        .post('/api/webhooks', { id: newId(), project_id: otherProjectId, url: webhook.url });
      expect(otherProject.status).toBe(201);
    });

    it('answers 404 for a project the caller cannot access', async () => {
      const projectId = await createProject('wh-foreign');

      const res = await ctx
        .request(outsider.token)
        .post('/api/webhooks', { id: newId(), project_id: projectId, url: uniqueUrl() });
      expect(res.status).toBe(404);
      expect((await res.json()) as { error: string }).toEqual({ error: 'Project not found' });
    });

    it('rejects a URL the target guard refuses and one that is too long', async () => {
      const projectId = await createProject('wh-bad-url');

      const scheme = await ctx
        .request(user.token)
        .post('/api/webhooks', { id: newId(), project_id: projectId, url: 'ftp://example.com/x' });
      expect(scheme.status).toBe(422);
      expect(((await scheme.json()) as { error: string }).error).toMatch(/http or https/);

      const tooLong = await ctx.request(user.token).post('/api/webhooks', {
        id: newId(),
        project_id: projectId,
        url: `https://example.com/${'a'.repeat(2000)}`,
      });
      expect(tooLong.status).toBe(422);
    });

    it('caps a project at ten registrations', async () => {
      const projectId = await createProject('wh-cap');
      for (let i = 0; i < 10; i++) {
        await createWebhook(projectId);
      }

      const res = await ctx
        .request(user.token)
        .post('/api/webhooks', { id: newId(), project_id: projectId, url: uniqueUrl() });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toMatch(/maximum of 10 webhooks/);
    });
  });

  describe('GET /api/webhooks', () => {
    it('lists only the named project and requires the query param', async () => {
      const projectId = await createProject('wh-list');
      const otherProjectId = await createProject('wh-list-other');
      const mine = await createWebhook(projectId);
      await createWebhook(otherProjectId);

      const res = await ctx.request(user.token).get(`/api/webhooks?project_id=${projectId}`);
      expect(res.status).toBe(200);
      const { webhooks } = (await res.json()) as { webhooks: WebhookBody[] };
      expect(webhooks.map((w) => w.id)).toEqual([mine.id]);
      expect(webhooks[0].secret).toBe(mine.secret);

      expect((await ctx.request(user.token).get('/api/webhooks')).status).toBe(400);
    });

    it('answers 404 for a project the caller cannot access', async () => {
      const projectId = await createProject('wh-list-foreign');
      await createWebhook(projectId);

      const res = await ctx.request(outsider.token).get(`/api/webhooks?project_id=${projectId}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/webhooks/:id', () => {
    it('changes the url and validates the new one', async () => {
      const projectId = await createProject('wh-patch-url');
      const webhook = await createWebhook(projectId);
      const url = uniqueUrl();

      const ok = await ctx.request(user.token).patch(`/api/webhooks/${webhook.id}`, { url });
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as WebhookBody).url).toBe(url);

      const bad = await ctx
        .request(user.token)
        .patch(`/api/webhooks/${webhook.id}`, { url: 'ftp://example.com/x' });
      expect(bad.status).toBe(422);
    });

    it('rejects a url already registered in the project', async () => {
      const projectId = await createProject('wh-patch-conflict');
      const first = await createWebhook(projectId);
      const second = await createWebhook(projectId);

      const res = await ctx
        .request(user.token)
        .patch(`/api/webhooks/${second.id}`, { url: first.url });
      expect(res.status).toBe(409);
    });

    it('disables, terminates the queued backlog, then re-enables and clears the failure count', async () => {
      const projectId = await createProject('wh-patch-disable');
      const webhook = await createWebhook(projectId);
      const deliveryId = await insertPendingDelivery(webhook.id);
      await db
        .updateTable('project_webhook')
        .set({ consecutive_failures: 4 })
        .where('id', '=', webhook.id)
        .execute();

      const disabled = await ctx
        .request(user.token)
        .patch(`/api/webhooks/${webhook.id}`, { disabled_at: new Date().toISOString() });
      expect(disabled.status).toBe(200);
      expect(((await disabled.json()) as WebhookBody).disabled_at).not.toBeNull();

      const stranded = await db
        .selectFrom('webhook_delivery')
        .selectAll()
        .where('id', '=', deliveryId)
        .executeTakeFirstOrThrow();
      expect(stranded.status).toBe('failed');
      expect(stranded.next_attempt_at).toBeNull();
      expect(stranded.last_error).toBe('Webhook disabled');

      const enabled = await ctx
        .request(user.token)
        .patch(`/api/webhooks/${webhook.id}`, { disabled_at: null });
      expect(enabled.status).toBe(200);
      const body = (await enabled.json()) as WebhookBody;
      expect(body.disabled_at).toBeNull();
      expect(body.consecutive_failures).toBe(0);

      const stillTerminal = await db
        .selectFrom('webhook_delivery')
        .select(['status', 'next_attempt_at'])
        .where('id', '=', deliveryId)
        .executeTakeFirstOrThrow();
      expect(stillTerminal.status).toBe('failed');
      expect(stillTerminal.next_attempt_at).toBeNull();
    });

    it('answers 404 for another user’s webhook', async () => {
      const projectId = await createProject('wh-patch-foreign');
      const webhook = await createWebhook(projectId);

      const res = await ctx
        .request(outsider.token)
        .patch(`/api/webhooks/${webhook.id}`, { url: uniqueUrl() });
      expect(res.status).toBe(404);
      expect((await res.json()) as { error: string }).toEqual({ error: 'Webhook not found' });
    });
  });

  describe('POST /api/webhooks/:id/rotate-secret', () => {
    it('replaces the stored secret', async () => {
      const projectId = await createProject('wh-rotate');
      const webhook = await createWebhook(projectId);

      const res = await ctx.request(user.token).post(`/api/webhooks/${webhook.id}/rotate-secret`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as WebhookBody;
      expect(body.secret).not.toBe(webhook.secret);

      const row = await db
        .selectFrom('project_webhook')
        .select('secret')
        .where('id', '=', webhook.id)
        .executeTakeFirstOrThrow();
      expect(row.secret).toBe(body.secret);
    });

    it('answers 404 for another user’s webhook', async () => {
      const projectId = await createProject('wh-rotate-foreign');
      const webhook = await createWebhook(projectId);

      const res = await ctx
        .request(outsider.token)
        .post(`/api/webhooks/${webhook.id}/rotate-secret`);
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/webhooks/:id', () => {
    it('deletes the registration and its deliveries', async () => {
      const projectId = await createProject('wh-delete');
      const webhook = await createWebhook(projectId);
      await insertPendingDelivery(webhook.id);

      expect((await ctx.request(user.token).delete(`/api/webhooks/${webhook.id}`)).status).toBe(
        204
      );
      expect(
        (await ctx.request(user.token).get(`/api/webhooks/${webhook.id}/deliveries`)).status
      ).toBe(404);

      const remaining = await db
        .selectFrom('webhook_delivery')
        .select('id')
        .where('webhook_id', '=', webhook.id)
        .execute();
      expect(remaining).toHaveLength(0);
    });

    it('cascades both tables away with the project', async () => {
      const projectId = await createProject('wh-cascade');
      const webhook = await createWebhook(projectId);
      await insertPendingDelivery(webhook.id);

      await db.deleteFrom('project').where('id', '=', projectId).execute();
      projectIds.splice(projectIds.indexOf(projectId), 1);

      const webhooks = await db
        .selectFrom('project_webhook')
        .select('id')
        .where('id', '=', webhook.id)
        .execute();
      const deliveries = await db
        .selectFrom('webhook_delivery')
        .select('id')
        .where('webhook_id', '=', webhook.id)
        .execute();
      expect(webhooks).toHaveLength(0);
      expect(deliveries).toHaveLength(0);
    });

    it('answers 404 for another user’s webhook', async () => {
      const projectId = await createProject('wh-delete-foreign');
      const webhook = await createWebhook(projectId);

      expect((await ctx.request(outsider.token).delete(`/api/webhooks/${webhook.id}`)).status).toBe(
        404
      );
    });
  });

  describe('GET /api/webhooks/:id/deliveries', () => {
    it('bounds the limit query param', async () => {
      const projectId = await createProject('wh-deliveries-limit');
      const webhook = await createWebhook(projectId);

      expect(
        (await ctx.request(user.token).get(`/api/webhooks/${webhook.id}/deliveries?limit=0`)).status
      ).toBe(400);
      expect(
        (await ctx.request(user.token).get(`/api/webhooks/${webhook.id}/deliveries?limit=51`))
          .status
      ).toBe(400);
      expect(
        (await ctx.request(user.token).get(`/api/webhooks/${webhook.id}/deliveries?limit=50`))
          .status
      ).toBe(200);
    });

    it('answers 404 for another user’s webhook', async () => {
      const projectId = await createProject('wh-deliveries-foreign');
      const webhook = await createWebhook(projectId);

      expect(
        (await ctx.request(outsider.token).get(`/api/webhooks/${webhook.id}/deliveries`)).status
      ).toBe(404);
    });
  });

  describe('POST /api/webhooks/:id/deliveries/:deliveryId/redeliver', () => {
    it('answers 404 for a delivery belonging to another webhook', async () => {
      const projectId = await createProject('wh-redeliver-mismatch');
      const webhook = await createWebhook(projectId);
      const other = await createWebhook(projectId);
      const deliveryId = await insertPendingDelivery(other.id);

      const res = await ctx
        .request(user.token)
        .post(`/api/webhooks/${webhook.id}/deliveries/${deliveryId}/redeliver`);
      expect(res.status).toBe(404);
    });

    it('answers 409 for a delivery that is not failed', async () => {
      const projectId = await createProject('wh-redeliver-pending');
      const webhook = await createWebhook(projectId);
      const deliveryId = await insertPendingDelivery(webhook.id);

      const res = await ctx
        .request(user.token)
        .post(`/api/webhooks/${webhook.id}/deliveries/${deliveryId}/redeliver`);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toMatch(/failed delivery/);
    });

    it('answers 409 while the webhook is disabled', async () => {
      const projectId = await createProject('wh-redeliver-disabled');
      const webhook = await createWebhook(projectId);
      const deliveryId = await insertPendingDelivery(webhook.id);
      await db
        .updateTable('webhook_delivery')
        .set({ status: 'failed', next_attempt_at: null })
        .where('id', '=', deliveryId)
        .execute();
      await db
        .updateTable('project_webhook')
        .set({ disabled_at: new Date() })
        .where('id', '=', webhook.id)
        .execute();

      const res = await ctx
        .request(user.token)
        .post(`/api/webhooks/${webhook.id}/deliveries/${deliveryId}/redeliver`);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toMatch(/disabled/);
    });
  });
});
