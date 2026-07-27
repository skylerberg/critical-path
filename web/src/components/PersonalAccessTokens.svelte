<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError, assertOk } from '../api/client';
  import type { components } from '../api/api.generated';
  import { newId } from '../lib/ids';
  import { toasts } from '../lib/toasts.svelte';
  import Badge from './ui/Badge.svelte';
  import Button from './ui/Button.svelte';
  import Input from './ui/Input.svelte';
  import Modal from './ui/Modal.svelte';

  type PersonalAccessToken = components['schemas']['PersonalAccessToken'];

  const EXPIRY_CHOICES = [
    { value: 'never', label: 'Never' },
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
    { value: '365', label: '1 year' },
  ] as const;

  let tokens = $state<PersonalAccessToken[]>([]);
  let loaded = $state(false);
  let loadError = $state<string | null>(null);
  let name = $state('');
  let expiry = $state<(typeof EXPIRY_CHOICES)[number]['value']>('never');
  let creating = $state(false);
  let createError = $state<string | null>(null);
  let created = $state<{ token: string; name: string } | null>(null);
  let copied = $state(false);
  let confirmingRevokeId = $state<string | null>(null);
  let revision = 0;

  onMount(() => {
    void load();
  });

  async function load(): Promise<void> {
    loadError = null;
    const seen = revision;
    try {
      const data = assertOk(await api.GET('/api/auth/tokens'));
      // A create or revoke that landed while this was in flight knows more than
      // a response the server built before it happened.
      if (seen === revision) {
        tokens = data.personal_access_tokens;
      }
      loaded = true;
    } catch (error) {
      loadError = messageFor(error);
    }
  }

  async function create(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      createError = 'Give the token a name';
      return;
    }
    creating = true;
    createError = null;
    try {
      const data = assertOk(
        await api.POST('/api/auth/tokens', {
          body: { id: newId(), name: trimmed, expires_at: expiresAt() },
        })
      );
      revision += 1;
      tokens = [data.personal_access_token, ...tokens];
      name = '';
      expiry = 'never';
      copied = false;
      created = { token: data.token, name: data.personal_access_token.name };
    } catch (error) {
      createError = messageFor(error);
    } finally {
      creating = false;
    }
  }

  function expiresAt(): string | null {
    if (expiry === 'never') {
      return null;
    }
    return new Date(Date.now() + Number(expiry) * 24 * 60 * 60 * 1000).toISOString();
  }

  function requestRevoke(token: PersonalAccessToken): void {
    if (confirmingRevokeId !== token.id) {
      confirmingRevokeId = token.id;
      return;
    }
    confirmingRevokeId = null;
    void revoke(token);
  }

  async function revoke(token: PersonalAccessToken): Promise<void> {
    revision += 1;
    tokens = tokens.filter((candidate) => candidate.id !== token.id);
    try {
      assertOk(await api.DELETE('/api/auth/tokens/{id}', { params: { path: { id: token.id } } }));
    } catch {
      toasts.error('Could not revoke that token');
      await load();
    }
  }

  async function copy(): Promise<void> {
    if (created === null) return;
    try {
      await navigator.clipboard.writeText(created.token);
      copied = true;
    } catch {
      toasts.error('Could not copy to the clipboard');
    }
  }

  function isExpired(token: PersonalAccessToken): boolean {
    return token.expires_at !== null && new Date(token.expires_at) <= new Date();
  }

  function formatDate(value: string): string {
    return new Date(value).toLocaleDateString();
  }

  function messageFor(error: unknown): string {
    if (error instanceof ApiError) {
      return error.message;
    }
    return 'Could not reach the server. Check your connection and try again.';
  }
</script>

<form class="flex flex-col gap-3 sm:flex-row sm:items-end" novalidate onsubmit={create}>
  <div class="flex-1">
    <Input label="Token name" name="token-name" placeholder="CI runner" bind:value={name} />
  </div>
  <div class="flex flex-col gap-1">
    <label for="token-expiry" class="text-sm font-medium">Expires</label>
    <select
      id="token-expiry"
      bind:value={expiry}
      class="min-h-11 rounded-md border border-edge bg-surface px-3 text-sm outline-none focus:border-accent"
    >
      {#each EXPIRY_CHOICES as choice (choice.value)}
        <option value={choice.value}>{choice.label}</option>
      {/each}
    </select>
  </div>
  <Button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create token'}</Button>
</form>

{#if createError !== null}
  <p role="alert" class="text-sm text-danger">{createError}</p>
{/if}

{#if !loaded}
  {#if loadError !== null}
    <div class="flex flex-col items-start gap-3">
      <p role="alert" class="text-sm text-danger">{loadError}</p>
      <Button variant="secondary" onclick={() => void load()}>Retry</Button>
    </div>
  {:else}
    <p class="text-sm text-muted">Loading tokens…</p>
  {/if}
{:else if tokens.length === 0}
  <p class="text-sm text-muted">You have no personal access tokens yet.</p>
{:else}
  <ul class="flex flex-col divide-y divide-edge">
    {#each tokens as token (token.id)}
      <li class="flex items-center justify-between gap-3 py-3">
        <div class="min-w-0">
          <p class="flex items-center gap-2 font-medium">
            <span class="truncate">{token.name}</span>
            {#if isExpired(token)}
              <Badge variant="danger">Expired</Badge>
            {/if}
          </p>
          <p class="text-sm text-muted">
            Created {formatDate(token.created_at)} · {token.expires_at === null
              ? 'never expires'
              : `expires ${formatDate(token.expires_at)}`}
          </p>
        </div>
        <Button
          variant="danger"
          aria-label={confirmingRevokeId === token.id
            ? `Confirm revoke of ${token.name}`
            : `Revoke ${token.name}`}
          onclick={() => requestRevoke(token)}
        >
          {confirmingRevokeId === token.id ? 'Confirm revoke' : 'Revoke'}
        </Button>
      </li>
    {/each}
  </ul>
{/if}

<Modal
  open={created !== null}
  title="Copy your new token"
  onclose={() => {
    created = null;
  }}
>
  {#if created !== null}
    <p class="mb-3 text-sm text-muted">
      This is the only time <strong>{created.name}</strong> is shown. Store it somewhere safe — you cannot
      see it again.
    </p>
    <input
      readonly
      value={created.token}
      aria-label="New personal access token"
      class="min-h-11 w-full rounded-md border border-edge bg-canvas px-3 font-mono text-sm outline-none"
    />
  {/if}
  {#snippet footer()}
    <Button variant="secondary" onclick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
    <Button
      onclick={() => {
        created = null;
      }}
    >
      Done
    </Button>
  {/snippet}
</Modal>
