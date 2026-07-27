import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';
import { newId } from './ids';
import { toasts } from './toasts.svelte';

export type Webhook = components['schemas']['Webhook'];
export type WebhookDelivery = components['schemas']['WebhookDelivery'];

class WebhooksStore {
  list = $state<Webhook[]>([]);
  deliveries = $state<Record<string, WebhookDelivery[]>>({});
  loaded = $state(false);
  loading = $state(false);
  loadError = $state<string | null>(null);
  deliveriesLoading = $state<string | null>(null);

  #projectId: string | null = null;

  // Reports rather than throws: a client that reaches production ahead of the
  // API rollout must render an error, not break the board it is opened from.
  async load(projectId: string): Promise<void> {
    this.#projectId = projectId;
    this.loading = true;
    this.loadError = null;
    try {
      const data = assertOk(
        await api.GET('/api/webhooks', { params: { query: { project_id: projectId } } })
      );
      this.list = data.webhooks;
      this.loaded = true;
    } catch (error) {
      this.loadError = error instanceof ApiError ? error.message : 'Failed to load webhooks';
    } finally {
      this.loading = false;
    }
  }

  reset(): void {
    this.#projectId = null;
    this.list = [];
    this.deliveries = {};
    this.loaded = false;
    this.loading = false;
    this.loadError = null;
    this.deliveriesLoading = null;
  }

  async create(projectId: string, url: string): Promise<void> {
    const id = newId();
    const optimistic: Webhook = {
      id,
      project_id: projectId,
      url,
      secret: '',
      disabled_at: null,
      consecutive_failures: 0,
      created_at: new Date().toISOString(),
    };
    this.list = [...this.list, optimistic];
    try {
      const row = assertOk(
        await api.POST('/api/webhooks', { body: { id, project_id: projectId, url } })
      );
      this.#replace(id, row);
    } catch (error) {
      // Rethrown after the resync so the form can show the rejection inline;
      // 422 is what both the target guard and the per-project cap answer.
      await this.load(projectId);
      throw error;
    }
  }

  async setUrl(id: string, url: string): Promise<void> {
    await this.#patch(id, { url }, 'Failed to update the webhook URL');
  }

  async setDisabled(id: string, disabled: boolean): Promise<void> {
    await this.#patch(
      id,
      { disabled_at: disabled ? new Date().toISOString() : null },
      disabled ? 'Failed to disable the webhook' : 'Failed to enable the webhook'
    );
  }

  async rotateSecret(id: string): Promise<void> {
    try {
      const row = assertOk(
        await api.POST('/api/webhooks/{id}/rotate-secret', { params: { path: { id } } })
      );
      this.#replace(id, row);
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to rotate the secret');
    }
  }

  async remove(id: string): Promise<void> {
    this.list = this.list.filter((webhook) => webhook.id !== id);
    this.deliveries = Object.fromEntries(
      Object.entries(this.deliveries).filter(([webhookId]) => webhookId !== id)
    );
    try {
      assertOk(await api.DELETE('/api/webhooks/{id}', { params: { path: { id } } }));
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to delete the webhook');
    }
  }

  async loadDeliveries(webhookId: string): Promise<void> {
    this.deliveriesLoading = webhookId;
    try {
      const data = assertOk(
        await api.GET('/api/webhooks/{id}/deliveries', { params: { path: { id: webhookId } } })
      );
      this.deliveries = { ...this.deliveries, [webhookId]: data.deliveries };
    } catch (error) {
      toasts.error(error instanceof ApiError ? error.message : 'Failed to load deliveries');
    } finally {
      this.deliveriesLoading = null;
    }
  }

  async redeliver(webhookId: string, deliveryId: string): Promise<void> {
    this.#updateDelivery(webhookId, deliveryId, (delivery) => ({
      ...delivery,
      status: 'pending',
      last_error: null,
    }));
    try {
      assertOk(
        await api.POST('/api/webhooks/{id}/deliveries/{deliveryId}/redeliver', {
          params: { path: { id: webhookId, deliveryId } },
        })
      );
    } catch (error) {
      toasts.error(error instanceof ApiError ? error.message : 'Failed to re-send the delivery');
    }
    await this.loadDeliveries(webhookId);
  }

  async #patch(
    id: string,
    body: components['schemas']['PatchWebhook'],
    failMessage: string
  ): Promise<void> {
    this.#update(id, (webhook) => ({ ...webhook, ...body }));
    try {
      const row = assertOk(
        await api.PATCH('/api/webhooks/{id}', { params: { path: { id } }, body })
      );
      this.#replace(id, row);
    } catch (error) {
      await this.#mutationFailed(error, failMessage);
    }
  }

  #update(id: string, patch: (webhook: Webhook) => Webhook): void {
    this.list = this.list.map((webhook) => (webhook.id === id ? patch(webhook) : webhook));
  }

  #replace(id: string, row: Webhook): void {
    this.#update(id, () => row);
  }

  #updateDelivery(
    webhookId: string,
    deliveryId: string,
    patch: (delivery: WebhookDelivery) => WebhookDelivery
  ): void {
    const existing = this.deliveries[webhookId];
    if (existing === undefined) return;
    this.deliveries = {
      ...this.deliveries,
      [webhookId]: existing.map((delivery) =>
        delivery.id === deliveryId ? patch(delivery) : delivery
      ),
    };
  }

  async #mutationFailed(error: unknown, fallback: string): Promise<void> {
    toasts.error(error instanceof ApiError ? error.message : fallback);
    if (this.#projectId !== null) {
      await this.load(this.#projectId);
    }
  }
}

export const webhooks = new WebhooksStore();
