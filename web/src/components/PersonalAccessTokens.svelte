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
  type Status = { kind: 'success' | 'error'; message: string } | null;

  const EXPIRY_CHOICES = [
    { value: 'never', label: 'Never' },
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
    { value: '365', label: '1 year' },
  ] as const;

  let tokens = $state<PersonalAccessToken[]>([]);
  let loading = $state(true);
  let name = $state('');
  let expiry = $state<(typeof EXPIRY_CHOICES)[number]['value']>('never');
  let creating = $state(false);
  let status = $state<Status>(null);
  let created = $state<{ token: string; name: string } | null>(null);
  let copied = $state(false);

  onMount(() => {
    void load();
  });

  async function load(): Promise<void> {
    loading = true;
    try {
      const data = assertOk(await api.GET('/api/auth/tokens'));
      tokens = data.personal_access_tokens;
    } catch (error) {
      status = { kind: 'error', message: messageFor(error) };
    } finally {
      loading = false;
    }
  }

  async function create(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      status = { kind: 'error', message: 'Give the token a name' };
      return;
    }
    creating = true;
    status = null;
    try {
      const data = assertOk(
        await api.POST('/api/auth/tokens', {
          body: { id: newId(), name: trimmed, expires_at: expiresAt() },
        })
      );
      tokens = [data.personal_access_token, ...tokens];
      name = '';
      expiry = 'never';
      copied = false;
      created = { token: data.token, name: data.personal_access_token.name };
    } catch (error) {
      status = { kind: 'error', message: messageFor(error) };
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

  async function revoke(token: PersonalAccessToken): Promise<void> {
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
      await navigator.clipboard?.writeText(created.token);
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

{#if status !== null}
  <p
    role={status.kind === 'error' ? 'alert' : 'status'}
    class="text-sm {status.kind === 'error' ? 'text-danger' : 'text-accent'}"
  >
    {status.message}
  </p>
{/if}

{#if loading}
  <p class="text-sm text-muted">Loading tokens…</p>
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
        <Button variant="danger" onclick={() => revoke(token)}>Revoke</Button>
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
