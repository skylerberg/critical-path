<script lang="ts">
  import { untrack } from 'svelte';
  import { apiMessage } from '../lib/apiMessages';
  import { webhooks, type Webhook, type WebhookDelivery } from '../lib/webhooks.svelte';
  import Badge from './ui/Badge.svelte';
  import Button from './ui/Button.svelte';
  import Input from './ui/Input.svelte';
  import Modal from './ui/Modal.svelte';
  import OfflineNotice from './OfflineNotice.svelte';

  interface Props {
    projectId: string;
    onclose: () => void;
  }

  let { projectId, onclose }: Props = $props();

  let url = $state('');
  let creating = $state(false);
  let createError = $state('');
  let expandedId = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);

  // The store is a singleton that still holds the previous project's endpoints and
  // secrets until this project's load lands, so nothing paints until it has.
  const scoped = $derived(webhooks.currentProjectId === projectId);
  const rows = $derived(scoped && webhooks.loaded ? webhooks.list : null);
  const loadError = $derived(scoped ? webhooks.loadError : null);

  $effect(() => {
    const id = projectId;
    untrack(() => void webhooks.load(id));
  });

  async function create(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const trimmed = url.trim();
    if (trimmed === '') {
      createError = 'Enter the URL to call';
      return;
    }
    if (!isHttpUrl(trimmed)) {
      createError = 'Enter a full URL starting with http:// or https://';
      return;
    }
    creating = true;
    createError = '';
    try {
      await webhooks.create(projectId, trimmed);
      url = '';
    } catch (error) {
      createError = apiMessage(error, 'Could not register that endpoint. Try again.');
    } finally {
      creating = false;
    }
  }

  function isHttpUrl(value: string): boolean {
    try {
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }

  function requestDelete(webhook: Webhook): void {
    if (confirmingDeleteId !== webhook.id) {
      confirmingDeleteId = webhook.id;
      return;
    }
    confirmingDeleteId = null;
    void webhooks.remove(webhook.id);
  }

  function toggleDeliveries(webhook: Webhook): void {
    if (expandedId === webhook.id) {
      expandedId = null;
      return;
    }
    expandedId = webhook.id;
    void webhooks.loadDeliveries(webhook.id);
  }

  function badgeVariant(delivery: WebhookDelivery): 'success' | 'danger' | 'neutral' {
    if (delivery.status === 'delivered') return 'success';
    if (delivery.status === 'failed') return 'danger';
    return 'neutral';
  }

  function formatTime(value: string): string {
    return new Date(value).toLocaleString();
  }
</script>

<OfflineNotice />

<Modal open title="Webhooks" {onclose}>
  <div class="flex flex-col gap-5">
    <p class="text-sm text-muted">
      Every change on this board is sent to these endpoints as a signed POST. Anyone with access to
      this board can read the signing secrets.
    </p>

    {#if rows === null}
      {#if loadError !== null}
        <div class="flex flex-col items-start gap-3">
          <p role="alert" class="text-sm text-danger">{loadError}</p>
          <Button variant="secondary" onclick={() => void webhooks.load(projectId)}>
            Try again
          </Button>
        </div>
      {:else}
        <p class="text-sm text-muted">Loading webhooks…</p>
      {/if}
    {:else if rows.length === 0}
      <p class="text-sm text-muted">No endpoints registered yet.</p>
    {:else}
      <ul class="flex max-h-[50vh] flex-col divide-y divide-edge overflow-y-auto">
        {#each rows as webhook (webhook.id)}
          <li class="flex flex-col gap-2 py-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="min-w-0 flex-1 truncate font-mono text-sm">{webhook.url}</span>
              {#if webhook.disabled_at === null}
                <Badge variant="success">Active</Badge>
              {:else}
                <Badge variant="danger">Disabled</Badge>
              {/if}
              {#if webhook.consecutive_failures > 0}
                <Badge variant="danger">
                  {webhook.consecutive_failures} consecutive failure{webhook.consecutive_failures ===
                  1
                    ? ''
                    : 's'}
                </Badge>
              {/if}
            </div>

            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium text-muted">Signing secret</span>
              <code
                class="block overflow-x-auto rounded-md border border-edge bg-canvas px-3 py-2 font-mono text-xs"
                >{webhook.secret}</code
              >
            </div>

            <div class="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                aria-label="Rotate secret for {webhook.url}"
                onclick={() => void webhooks.rotateSecret(webhook.id)}
              >
                Rotate secret
              </Button>
              <Button
                variant="secondary"
                aria-label="{webhook.disabled_at === null ? 'Disable' : 'Enable'} {webhook.url}"
                onclick={() => void webhooks.setDisabled(webhook.id, webhook.disabled_at === null)}
              >
                {webhook.disabled_at === null ? 'Disable' : 'Enable'}
              </Button>
              <Button
                variant="secondary"
                aria-expanded={expandedId === webhook.id}
                aria-label="Deliveries for {webhook.url}"
                onclick={() => toggleDeliveries(webhook)}
              >
                Deliveries
              </Button>
              <Button
                variant="danger"
                aria-label="{confirmingDeleteId === webhook.id
                  ? 'Confirm delete of'
                  : 'Delete'} {webhook.url}"
                onclick={() => requestDelete(webhook)}
              >
                {confirmingDeleteId === webhook.id ? 'Confirm delete' : 'Delete'}
              </Button>
            </div>

            {#if expandedId === webhook.id}
              {@const deliveries = webhooks.deliveries[webhook.id]}
              {@const deliveriesError = webhooks.deliveriesError[webhook.id]}
              <div class="flex flex-col gap-2 border-t border-edge pt-2">
                {#if deliveriesError !== undefined}
                  <div class="flex flex-wrap items-center gap-2">
                    <p role="alert" class="text-sm text-danger">{deliveriesError}</p>
                    <Button
                      variant="secondary"
                      aria-label="Try again loading deliveries for {webhook.url}"
                      onclick={() => void webhooks.loadDeliveries(webhook.id)}
                    >
                      Try again
                    </Button>
                  </div>
                {/if}
                {#if deliveries !== undefined}
                  {#if deliveries.length === 0}
                    <p class="text-sm text-muted">Nothing has been sent to this endpoint yet.</p>
                  {:else}
                    <ul class="flex flex-col gap-2">
                      {#each deliveries as delivery (delivery.id)}
                        <li class="flex flex-col gap-1 text-sm">
                          <div class="flex flex-wrap items-center gap-2">
                            <Badge variant={badgeVariant(delivery)}>{delivery.status}</Badge>
                            <span class="font-mono text-xs">{delivery.event_type}</span>
                            <span class="text-xs text-muted">{formatTime(delivery.created_at)}</span
                            >
                            {#if delivery.last_status_code !== null}
                              <span class="text-xs text-muted">
                                HTTP {delivery.last_status_code}
                              </span>
                            {/if}
                            {#if delivery.status === 'failed'}
                              <Button
                                variant="secondary"
                                aria-label="Resend {delivery.event_type} delivery from {formatTime(
                                  delivery.created_at
                                )}"
                                onclick={() => void webhooks.redeliver(webhook.id, delivery.id)}
                              >
                                Resend
                              </Button>
                            {/if}
                          </div>
                          {#if delivery.last_error !== null}
                            <p class="truncate text-xs text-danger">{delivery.last_error}</p>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                {:else if webhooks.deliveriesLoading === webhook.id}
                  <p class="text-sm text-muted">Loading deliveries…</p>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <form
      class="flex flex-col gap-3 border-t border-edge pt-4"
      aria-label="New webhook"
      novalidate
      onsubmit={create}
    >
      <Input
        label="Endpoint URL"
        name="webhook-url"
        placeholder="https://example.com/critical-path"
        bind:value={url}
      />
      {#if createError !== ''}
        <p role="alert" class="text-sm text-danger">{createError}</p>
      {/if}
      <Button type="submit" class="self-start" disabled={creating}>
        {creating ? 'Adding…' : 'Add webhook'}
      </Button>
    </form>
  </div>
</Modal>
