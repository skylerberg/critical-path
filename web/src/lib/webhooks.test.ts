import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { webhooks, type Webhook, type WebhookDelivery } from './webhooks.svelte';
import { toasts } from './toasts.svelte';

function webhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: 'w-1',
    project_id: 'p-1',
    url: 'https://example.com/hook',
    secret: 'sec-1',
    disabled_at: null,
    consecutive_failures: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function delivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: 'd-1',
    webhook_id: 'w-1',
    event_type: 'task_created',
    status: 'failed',
    attempt_count: 6,
    redelivery_count: 0,
    last_status_code: 500,
    last_error: 'Receiver responded 500',
    next_attempt_at: null,
    last_attempt_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    payload: { id: 'd-1' },
    ...overrides,
  };
}

async function loadWith(items: Webhook[]): Promise<void> {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { webhooks: items }));
  await webhooks.load('p-1');
}

beforeEach(() => {
  fetchMock.mockReset();
  webhooks.reset();
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
});

describe('webhooks store', () => {
  it('loads a project’s registrations', async () => {
    await loadWith([webhook()]);

    expect(webhooks.list).toEqual([webhook()]);
    expect(webhooks.loaded).toBe(true);
    expect(webhooks.loadError).toBeNull();
    expect(requestAt(0).url).toContain('/api/webhooks?project_id=p-1');
  });

  it('records a load failure instead of throwing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'Project not found' }));

    await expect(webhooks.load('p-1')).resolves.toBeUndefined();

    expect(webhooks.loadError).toBe('Project not found');
    expect(webhooks.loaded).toBe(false);
  });

  it('drops the previous project’s rows and log before the next load lands', async () => {
    await loadWith([webhook()]);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { deliveries: [delivery()] }));
    await webhooks.loadDeliveries('w-1');

    let settle: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        settle = resolve;
      })
    );
    const loading = webhooks.load('p-2');

    expect(webhooks.list).toEqual([]);
    expect(webhooks.deliveries).toEqual({});
    expect(webhooks.loaded).toBe(false);

    settle(jsonResponse(200, { webhooks: [webhook({ id: 'w-2', project_id: 'p-2' })] }));
    await loading;

    expect(webhooks.list.map((w) => w.id)).toEqual(['w-2']);
    expect(webhooks.currentProjectId).toBe('p-2');
  });

  it('discards a load that lost the race with a mutation', async () => {
    await loadWith([]);
    let settleLoad: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        settleLoad = resolve;
      })
    );
    const loading = webhooks.load('p-1');

    let settleCreate: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        settleCreate = resolve;
      })
    );
    const creating = webhooks.create('p-1', 'https://example.com/new');
    const optimisticId = webhooks.list[0].id;

    settleLoad(jsonResponse(200, { webhooks: [] }));
    await loading;
    expect(webhooks.list.map((w) => w.url)).toEqual(['https://example.com/new']);

    settleCreate(
      jsonResponse(
        201,
        webhook({ id: optimisticId, url: 'https://example.com/new', secret: 'real' })
      )
    );
    await creating;

    expect(webhooks.list.map((w) => w.secret)).toEqual(['real']);
  });

  it('discards a load that was in flight when the session ended', async () => {
    let settle: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        settle = resolve;
      })
    );
    const loading = webhooks.load('p-1');

    webhooks.reset();
    settle(jsonResponse(200, { webhooks: [webhook()] }));
    await loading;

    expect(webhooks.list).toEqual([]);
    expect(webhooks.loaded).toBe(false);
    expect(webhooks.currentProjectId).toBeNull();
  });

  it('shows the new row before the server answers, then adopts the real secret', async () => {
    await loadWith([]);
    let settle: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        settle = resolve;
      })
    );

    const pending = webhooks.create('p-1', 'https://example.com/new');
    await Promise.resolve();
    expect(webhooks.list).toHaveLength(1);
    expect(webhooks.list[0].url).toBe('https://example.com/new');
    expect(webhooks.list[0].secret).toBe('');

    const optimisticId = webhooks.list[0].id;
    settle(
      jsonResponse(
        201,
        webhook({ id: optimisticId, url: 'https://example.com/new', secret: 'real' })
      )
    );
    await pending;

    expect(webhooks.list).toHaveLength(1);
    expect(webhooks.list[0].secret).toBe('real');
    const body = (await requestAt(1).clone().json()) as { id: string; project_id: string };
    expect(body.id).toBe(optimisticId);
    expect(body.project_id).toBe('p-1');
  });

  it('resyncs and rethrows when the server rejects a new registration', async () => {
    await loadWith([webhook()]);
    fetchMock.mockResolvedValueOnce(jsonResponse(422, { error: 'Webhook URL must use https' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { webhooks: [webhook()] }));

    await expect(webhooks.create('p-1', 'http://10.0.0.1/hook')).rejects.toThrow(
      'Webhook URL must use https'
    );

    expect(webhooks.list).toEqual([webhook()]);
  });

  it('patches disabled_at optimistically in both directions', async () => {
    await loadWith([webhook()]);

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, webhook({ disabled_at: '2026-02-02T00:00:00.000Z' }))
    );
    await webhooks.setDisabled('w-1', true);
    expect(webhooks.list[0].disabled_at).toBe('2026-02-02T00:00:00.000Z');
    const disableBody = (await requestAt(1).clone().json()) as { disabled_at: string };
    expect(Number.isNaN(Date.parse(disableBody.disabled_at))).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, webhook()));
    await webhooks.setDisabled('w-1', false);
    expect(webhooks.list[0].disabled_at).toBeNull();
    expect(await requestAt(2).clone().json()).toEqual({ disabled_at: null });
  });

  it('swaps in the rotated secret', async () => {
    await loadWith([webhook()]);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, webhook({ secret: 'rotated' })));

    await webhooks.rotateSecret('w-1');

    expect(webhooks.list[0].secret).toBe('rotated');
    expect(requestAt(1).url).toContain('/api/webhooks/w-1/rotate-secret');
  });

  it('drops a deleted row immediately, and resyncs plus toasts on failure', async () => {
    await loadWith([webhook(), webhook({ id: 'w-2' })]);

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'Internal Server Error' }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { webhooks: [webhook(), webhook({ id: 'w-2' })] })
    );
    const removal = webhooks.remove('w-1');
    await Promise.resolve();
    expect(webhooks.list.map((w) => w.id)).toEqual(['w-2']);

    await removal;
    expect(webhooks.list.map((w) => w.id)).toEqual(['w-1', 'w-2']);
    expect(toasts.toasts.map((t) => t.message)).toContain('Internal Server Error');
  });

  it('loads a delivery log per webhook', async () => {
    await loadWith([webhook()]);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { deliveries: [delivery()] }));

    await webhooks.loadDeliveries('w-1');

    expect(webhooks.deliveries['w-1']).toEqual([delivery()]);
    expect(requestAt(1).url).toContain('/api/webhooks/w-1/deliveries');
  });

  it('records a per-webhook error when the delivery log cannot be read, and clears it on retry', async () => {
    await loadWith([webhook()]);
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'Internal Server Error' }));

    await webhooks.loadDeliveries('w-1');

    expect(webhooks.deliveriesError['w-1']).toBe('Internal Server Error');
    expect(webhooks.deliveries['w-1']).toBeUndefined();
    expect(webhooks.deliveriesLoading).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { deliveries: [delivery()] }));
    await webhooks.loadDeliveries('w-1');

    expect(webhooks.deliveriesError['w-1']).toBeUndefined();
    expect(webhooks.deliveries['w-1']).toEqual([delivery()]);
  });

  it('marks a re-sent delivery pending and reloads the log', async () => {
    await loadWith([webhook()]);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { deliveries: [delivery()] }));
    await webhooks.loadDeliveries('w-1');

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        deliveries: [delivery({ status: 'pending', attempt_count: 0, redelivery_count: 1 })],
      })
    );

    await webhooks.redeliver('w-1', 'd-1');

    expect(requestAt(2).url).toContain('/api/webhooks/w-1/deliveries/d-1/redeliver');
    expect(webhooks.deliveries['w-1'][0].status).toBe('pending');
    expect(webhooks.deliveries['w-1'][0].redelivery_count).toBe(1);
  });

  it('puts a refused disable back by refetching, and says why', async () => {
    await loadWith([webhook()]);

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'Cannot disable' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { webhooks: [webhook()] }));
    await webhooks.setDisabled('w-1', true);

    expect(toasts.toasts.map((toast) => toast.message)).toEqual(['Cannot disable']);
    expect(webhooks.list[0].disabled_at).toBeNull();
    expect(requestAt(2).url).toContain('/api/webhooks?project_id=p-1');
  });

  it('keeps the old secret when a rotation is refused', async () => {
    await loadWith([webhook()]);

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'Rotation failed' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { webhooks: [webhook()] }));
    await webhooks.rotateSecret('w-1');

    expect(toasts.toasts.map((toast) => toast.message)).toEqual(['Rotation failed']);
    expect(webhooks.list[0].secret).toBe('sec-1');
    expect(requestAt(2).url).toContain('/api/webhooks?project_id=p-1');
  });

  it('clears every cached secret on reset', async () => {
    await loadWith([webhook()]);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { deliveries: [delivery()] }));
    await webhooks.loadDeliveries('w-1');

    webhooks.reset();

    expect(webhooks.list).toEqual([]);
    expect(webhooks.deliveries).toEqual({});
    expect(webhooks.deliveriesError).toEqual({});
    expect(webhooks.loaded).toBe(false);
    expect(webhooks.loadError).toBeNull();
  });
});
