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

  it('clears every cached secret on reset', async () => {
    await loadWith([webhook()]);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { deliveries: [delivery()] }));
    await webhooks.loadDeliveries('w-1');

    webhooks.reset();

    expect(webhooks.list).toEqual([]);
    expect(webhooks.deliveries).toEqual({});
    expect(webhooks.loaded).toBe(false);
    expect(webhooks.loadError).toBeNull();
  });
});
