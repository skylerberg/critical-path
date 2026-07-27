import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import WebhooksModal from './WebhooksModal.svelte';
import { webhooks, type Webhook, type WebhookDelivery } from '../lib/webhooks.svelte';

function webhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: 'w-1',
    project_id: 'p-1',
    url: 'https://example.com/hook',
    secret: 'sec-abc',
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
    status: 'delivered',
    attempt_count: 1,
    redelivery_count: 0,
    last_status_code: 200,
    last_error: null,
    next_attempt_at: null,
    last_attempt_at: '2026-01-02T00:00:00.000Z',
    created_at: '2026-01-02T00:00:00.000Z',
    payload: { id: 'd-1' },
    ...overrides,
  };
}

function renderWith(items: Webhook[]) {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { webhooks: items }));
  return render(WebhooksModal, { projectId: 'p-1', onclose: () => {} });
}

beforeEach(() => {
  fetchMock.mockReset();
  webhooks.reset();
});

describe('WebhooksModal', () => {
  it('lists registrations with their status and secret', async () => {
    renderWith([
      webhook(),
      webhook({
        id: 'w-2',
        url: 'https://b.example/h',
        secret: 'sec-xyz',
        disabled_at: '2026-02-01T00:00:00.000Z',
        consecutive_failures: 5,
      }),
    ]);

    await waitFor(() => expect(screen.getByText('https://example.com/hook')).toBeInTheDocument());
    expect(screen.getByText('sec-abc')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('5 consecutive failures')).toBeInTheDocument();
  });

  it('renders an error row when the list cannot be loaded', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'Project not found' }));
    render(WebhooksModal, { projectId: 'p-1', onclose: () => {} });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Project not found'));
  });

  it('posts the typed URL with a generated id and the project id', async () => {
    renderWith([]);
    await waitFor(() =>
      expect(screen.getByText('No endpoints registered yet.')).toBeInTheDocument()
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(201, webhook({ url: 'https://new.example/h' })));
    await fireEvent.input(screen.getByLabelText('Endpoint URL'), {
      target: { value: 'https://new.example/h' },
    });
    await fireEvent.submit(screen.getByRole('form', { name: 'New webhook' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = requestAt(1);
    expect(request.method).toBe('POST');
    const body = (await request.clone().json()) as { id: string; project_id: string; url: string };
    expect(body.project_id).toBe('p-1');
    expect(body.url).toBe('https://new.example/h');
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not call the API for an empty URL', async () => {
    renderWith([]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await fireEvent.input(screen.getByLabelText('Endpoint URL'), { target: { value: '   ' } });
    await fireEvent.submit(screen.getByRole('form', { name: 'New webhook' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the URL to call');
  });

  it('shows a server rejection inline', async () => {
    renderWith([]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { error: 'Project already has the maximum of 10 webhooks' })
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { webhooks: [] }));
    await fireEvent.input(screen.getByLabelText('Endpoint URL'), {
      target: { value: 'https://new.example/h' },
    });
    await fireEvent.submit(screen.getByRole('form', { name: 'New webhook' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Project already has the maximum of 10 webhooks'
      )
    );
  });

  it('fetches the delivery log once per expand and offers Resend only on failures', async () => {
    renderWith([webhook()]);
    await waitFor(() => expect(screen.getByText('https://example.com/hook')).toBeInTheDocument());

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        deliveries: [
          delivery(),
          delivery({ id: 'd-2', status: 'failed', last_status_code: 500, last_error: 'boom' }),
        ],
      })
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Deliveries' }));

    await waitFor(() => expect(screen.getByText('delivered')).toBeInTheDocument());
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('HTTP 500')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Re-send/ })).toHaveLength(1);

    await fireEvent.click(screen.getByRole('button', { name: 'Deliveries' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Deliveries' }));
    await waitFor(() => expect(screen.getByText('delivered')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-sends a failed delivery', async () => {
    renderWith([webhook()]);
    await waitFor(() => expect(screen.getByText('https://example.com/hook')).toBeInTheDocument());
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { deliveries: [delivery({ status: 'failed', last_error: 'boom' })] })
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Deliveries' }));
    await waitFor(() => expect(screen.getByText('failed')).toBeInTheDocument());

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { deliveries: [delivery({ status: 'pending', last_error: null })] })
    );
    await fireEvent.click(screen.getByRole('button', { name: /^Re-send/ }));

    await waitFor(() => expect(screen.getByText('pending')).toBeInTheDocument());
    expect(requestAt(2).url).toContain('/api/webhooks/w-1/deliveries/d-1/redeliver');
  });

  it('removes a deleted registration from the list', async () => {
    renderWith([webhook()]);
    await waitFor(() => expect(screen.getByText('https://example.com/hook')).toBeInTheDocument());

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(screen.getByText('No endpoints registered yet.')).toBeInTheDocument()
    );
    expect(requestAt(1).method).toBe('DELETE');
  });

  it('rotates the secret in place', async () => {
    renderWith([webhook()]);
    await waitFor(() => expect(screen.getByText('sec-abc')).toBeInTheDocument());

    fetchMock.mockResolvedValueOnce(jsonResponse(200, webhook({ secret: 'sec-new' })));
    await fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));

    await waitFor(() => expect(screen.getByText('sec-new')).toBeInTheDocument());
  });
});
