<script lang="ts">
  import { onMount } from 'svelte';
  import { api, assertOk } from '../api/client';
  import type { components } from '../api/api.generated';
  import { apiMessage } from '../lib/apiMessages';
  import { newId } from '../lib/ids';
  import { formatExactTime, formatRelativeTime } from '../lib/relativeTime';
  import { toasts } from '../lib/toasts.svelte';
  import Badge from './ui/Badge.svelte';
  import Button from './ui/Button.svelte';
  import Input from './ui/Input.svelte';
  import Modal from './ui/Modal.svelte';
  import OfflineNotice from './OfflineNotice.svelte';

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
      loadError = apiMessage(error);
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
      createError = apiMessage(error);
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
</script>

<OfflineNotice />

<form class="flex flex-col gap-3 sm:flex-row sm:items-end" novalidate onsubmit={create}>
  <div class="flex-1">
    <Input label="Token name" name="token-name" placeholder="CI runner" bind:value={name} />
  </div>
  <div class="flex flex-col gap-1">
    <label for="token-expiry" class="text-sm font-medium">Expires</label>
    <select
      id="token-expiry"
      bind:value={expiry}
      class="min-h-11 rounded-md border border-edge bg-surface px-3 text-sm focus-ring focus:border-accent"
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

<!-- Outside the not-yet-loaded gate, as in Sessions.svelte: `loaded` never goes
     back to false, so a gate on it would swallow every load after the first —
     including the refetch a failed revoke makes to put the row back. -->
{#if loadError !== null}
  <div class="flex flex-col items-start gap-3">
    <p role="alert" class="text-sm text-danger">{loadError}</p>
    <Button variant="secondary" onclick={() => void load()}>Retry</Button>
  </div>
{/if}

{#if tokens.length > 0}
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
              : `expires ${formatDate(token.expires_at)}`} ·
            {#if token.last_used_at === null}
              never used
            {:else}
              last used <time
                datetime={token.last_used_at}
                title={formatExactTime(token.last_used_at)}
              >
                {formatRelativeTime(token.last_used_at)}
              </time>
            {/if}
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
{:else if loaded && loadError === null}
  <p class="text-sm text-muted">You have no personal access tokens yet.</p>
{:else if loadError === null}
  <p class="text-sm text-muted">Loading tokens…</p>
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
      class="min-h-11 w-full rounded-md border border-edge bg-canvas px-3 font-mono text-sm focus-ring"
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
