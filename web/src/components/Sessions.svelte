<script lang="ts">
  import { onMount } from 'svelte';
  import { api, assertOk } from '../api/client';
  import type { components } from '../api/api.generated';
  import { apiMessage } from '../lib/apiMessages';
  import { realtime } from '../lib/realtime.svelte';
  import { router } from '../lib/router.svelte';
  import { session } from '../lib/session.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import { describeDevice } from '../lib/userAgent';
  import Badge from './ui/Badge.svelte';
  import Button from './ui/Button.svelte';
  import OfflineNotice from './OfflineNotice.svelte';

  type AccountSession = components['schemas']['Session'];

  // Seconds would be noise, and the panel promises a moment you can recognize,
  // not one you can match to the millisecond.
  const momentFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

  let sessions = $state<AccountSession[]>([]);
  let loaded = $state(false);
  let inFlight = $state(0);
  let loadError = $state<string | null>(null);
  let confirmingRevokeId = $state<string | null>(null);
  let revision = 0;

  // Nothing short of this justifies saying the account has no sessions: a list
  // emptied by an optimistic removal looks identical until the refetch lands.
  const listIsKnownEmpty = $derived(loaded && inFlight === 0 && loadError === null);

  onMount(() => {
    void load();
  });

  async function load(): Promise<void> {
    loadError = null;
    inFlight += 1;
    const seen = revision;
    try {
      const data = assertOk(await api.GET('/api/auth/sessions'));
      // A revoke that landed while this was in flight knows more than a response
      // the server built before it happened.
      if (seen === revision) {
        sessions = data.sessions;
      }
      loaded = true;
    } catch (error) {
      loadError = apiMessage(error);
    } finally {
      inFlight -= 1;
    }
  }

  function requestRevoke(entry: AccountSession): void {
    if (confirmingRevokeId !== entry.id) {
      confirmingRevokeId = entry.id;
      return;
    }
    confirmingRevokeId = null;
    void revoke(entry);
  }

  async function revoke(entry: AccountSession): Promise<void> {
    revision += 1;
    sessions = sessions.filter((candidate) => candidate.id !== entry.id);
    // Dropped first: the server closes this device's socket on success, and the
    // automatic revalidate-and-reconnect would race the sign-out below.
    if (entry.is_current) {
      realtime.disconnect();
    }
    try {
      assertOk(await api.DELETE('/api/auth/sessions/{id}', { params: { path: { id: entry.id } } }));
      if (entry.is_current) {
        session.forget();
        router.navigate('/login');
      }
    } catch {
      if (entry.is_current) {
        realtime.connect();
      }
      toasts.error('Could not revoke that session');
      await load();
    }
  }

  function formatMoment(value: string): string {
    return momentFormat.format(new Date(value));
  }

  function formatDate(value: string): string {
    return dayFormat.format(new Date(value));
  }

  function buttonText(entry: AccountSession, confirming: boolean): string {
    if (entry.is_current) {
      return confirming ? 'Confirm sign out' : 'Sign out';
    }
    return confirming ? 'Confirm revoke' : 'Revoke';
  }

  // Two sessions can share a device and a starting minute, so the position is
  // what keeps every button's accessible name distinct.
  function buttonLabel(entry: AccountSession, index: number, confirming: boolean): string {
    if (entry.is_current) {
      return confirming ? 'Confirm sign out of this device' : 'Sign out of this device';
    }
    const subject =
      `session ${String(index + 1)} of ${String(sessions.length)}, ` +
      `${describeDevice(entry.user_agent)}, signed in ${formatMoment(entry.created_at)}`;
    return confirming ? `Confirm revoke of ${subject}` : `Revoke ${subject}`;
  }
</script>

<OfflineNotice />

{#if loadError !== null}
  <div class="flex flex-col items-start gap-3">
    <p role="alert" class="text-sm text-danger">{loadError}</p>
    <Button variant="secondary" onclick={() => void load()}>Retry</Button>
  </div>
{/if}

{#if sessions.length > 0}
  <ul class="flex flex-col divide-y divide-edge">
    {#each sessions as entry, index (entry.id)}
      <li class="flex items-center justify-between gap-3 py-3">
        <div class="min-w-0">
          <p class="flex items-center gap-2 font-medium">
            <span class="truncate">{describeDevice(entry.user_agent)}</span>
            {#if entry.is_current}
              <Badge variant="accent">This device</Badge>
            {/if}
          </p>
          <p class="text-sm text-muted">
            Signed in {formatMoment(entry.created_at)} · expires {formatDate(entry.expires_at)}
          </p>
        </div>
        <Button
          variant="danger"
          aria-label={buttonLabel(entry, index, confirmingRevokeId === entry.id)}
          onclick={() => requestRevoke(entry)}
        >
          {buttonText(entry, confirmingRevokeId === entry.id)}
        </Button>
      </li>
    {/each}
  </ul>
{:else if listIsKnownEmpty}
  <p class="text-sm text-muted">You have no active sessions.</p>
{:else if loadError === null}
  <p class="text-sm text-muted">Loading sessions…</p>
{/if}
