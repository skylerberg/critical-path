import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';
import { newId } from './ids';
import { toasts } from './toasts.svelte';

export type Webhook = components['schemas']['Webhook'];
export type WebhookDelivery = components['schemas']['WebhookDelivery'];

function omitKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(map).filter(([id]) => id !== key));
}

class WebhooksStore {
  currentProjectId = $state<string | null>(null);
  list = $state<Webhook[]>([]);
  deliveries = $state<Record<string, WebhookDelivery[]>>({});
  deliveriesError = $state<Record<string, string>>({});
  deliveriesLoading = $state<string | null>(null);
  loaded = $state(false);
  loadError = $state<string | null>(null);

  // Bumped by every mutation and by reset as well as by the reads themselves, so a
  // response the server built before a write — or before a logout — cannot land on
  // top of what the store already knows.
  #listToken = 0;
  #deliveriesToken = 0;

  // Reports rather than throws: a client that reaches production ahead of the
  // API rollout must render an error, not break the board it is opened from.
  async load(projectId: string): Promise<void> {
    if (projectId !== this.currentProjectId) {
      this.#clear();
      this.currentProjectId = projectId;
    }
    const token = ++this.#listToken;
    this.loadError = null;
    try {
      const data = assertOk(
        await api.GET('/api/webhooks', { params: { query: { project_id: projectId } } })
      );
      if (token !== this.#listToken) return;
      this.list = data.webhooks;
      this.loaded = true;
    } catch (error) {
      if (token !== this.#listToken) return;
      this.loadError = error instanceof ApiError ? error.message : 'Failed to load webhooks';
    }
  }

  reset(): void {
    this.#clear();
    this.currentProjectId = null;
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
    this.#listToken += 1;
    this.list = [...this.list, optimistic];
    try {
      const row = assertOk(
        await api.POST('/api/webhooks', { body: { id, project_id: projectId, url } })
      );
      this.#replace(id, row);
    } catch (error) {
      // Rethrown after the resync so the form can surface the rejection inline.
      await this.load(projectId);
      throw error;
    }
  }

  async setDisabled(id: string, disabled: boolean): Promise<void> {
    await this.#patch(
      id,
      { disabled_at: disabled ? new Date().toISOString() : null },
      disabled ? 'Failed to disable the webhook' : 'Failed to enable the webhook'
    );
  }

  async rotateSecret(id: string): Promise<void> {
    this.#listToken += 1;
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
    this.#listToken += 1;
    this.list = this.list.filter((webhook) => webhook.id !== id);
    this.deliveries = omitKey(this.deliveries, id);
    this.deliveriesError = omitKey(this.deliveriesError, id);
    try {
      assertOk(await api.DELETE('/api/webhooks/{id}', { params: { path: { id } } }));
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to delete the webhook');
    }
  }

  async loadDeliveries(webhookId: string): Promise<void> {
    const token = ++this.#deliveriesToken;
    this.deliveriesLoading = webhookId;
    // Cleared up front so a retry shows its loading state instead of the failure
    // it is already retrying.
    this.deliveriesError = omitKey(this.deliveriesError, webhookId);
    try {
      const data = assertOk(
        await api.GET('/api/webhooks/{id}/deliveries', { params: { path: { id: webhookId } } })
      );
      if (token !== this.#deliveriesToken) return;
      this.deliveries = { ...this.deliveries, [webhookId]: data.deliveries };
    } catch (error) {
      if (token !== this.#deliveriesToken) return;
      this.deliveriesError = {
        ...this.deliveriesError,
        [webhookId]: error instanceof ApiError ? error.message : 'Failed to load deliveries',
      };
    } finally {
      if (token === this.#deliveriesToken) {
        this.deliveriesLoading = null;
      }
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
    this.#listToken += 1;
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
    if (this.currentProjectId !== null) {
      await this.load(this.currentProjectId);
    }
  }

  #clear(): void {
    this.#listToken += 1;
    this.#deliveriesToken += 1;
    this.list = [];
    this.deliveries = {};
    this.deliveriesError = {};
    this.deliveriesLoading = null;
    this.loaded = false;
    this.loadError = null;
  }
}

export const webhooks = new WebhooksStore();
