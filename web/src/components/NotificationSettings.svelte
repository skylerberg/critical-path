<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError, assertOk } from '../api/client';
  import type { components } from '../api/api.generated';
  import { apiMessage } from '../lib/apiMessages';
  import { session } from '../lib/session.svelte';
  import Button from './ui/Button.svelte';

  type Settings = components['schemas']['NotificationSettings'];
  type Status = { kind: 'success' | 'error'; message: string } | null;

  const TOGGLES = [
    { key: 'task_assigned', label: 'When someone assigns me a task' },
    { key: 'added_to_project', label: 'When someone adds me to a board' },
  ] as const;

  let settings = $state<Settings | null>(null);
  let loadError = $state<string | null>(null);
  let saveStatus = $state<Status>(null);
  let saving = $state(false);
  let resending = $state(false);
  let resendStatus = $state<Status>(null);

  const unverified = $derived(session.user?.email_verified === false);

  onMount(() => {
    void load();
  });

  async function load(): Promise<void> {
    loadError = null;
    try {
      settings = assertOk(await api.GET('/api/auth/me/notification-settings'));
    } catch (error) {
      // Dropped rather than left standing: when this runs as the resync after a
      // failed save, the toggles hold a value the server never stored.
      settings = null;
      loadError = apiMessage(error);
    }
  }

  async function toggle(key: keyof Settings, checked: boolean): Promise<void> {
    if (settings === null) return;
    const next: Settings = { ...settings, [key]: checked };
    settings = next;
    saving = true;
    saveStatus = null;
    try {
      settings = assertOk(await api.PUT('/api/auth/me/notification-settings', { body: next }));
      saveStatus = { kind: 'success', message: 'Preferences saved' };
    } catch (error) {
      saveStatus = { kind: 'error', message: apiMessage(error) };
      await load();
    } finally {
      saving = false;
    }
  }

  async function resendVerification(): Promise<void> {
    resending = true;
    resendStatus = null;
    try {
      assertOk(await api.POST('/api/auth/verify-email/resend'));
      resendStatus = { kind: 'success', message: 'Verification email sent' };
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 429
          ? 'Too many requests — try again in a little while.'
          : apiMessage(error);
      resendStatus = { kind: 'error', message };
    } finally {
      resending = false;
    }
  }
</script>

{#snippet status(value: Status)}
  {#if value !== null}
    <p
      role={value.kind === 'error' ? 'alert' : 'status'}
      class="text-sm {value.kind === 'error' ? 'text-danger' : 'text-accent'}"
    >
      {value.message}
    </p>
  {/if}
{/snippet}

{#if unverified}
  <div class="flex flex-col items-start gap-2">
    <p class="text-sm text-muted">
      We're not sending email to {session.user?.email} because it hasn't been verified yet.
    </p>
    <Button variant="secondary" disabled={resending} onclick={resendVerification}>
      {resending ? 'Sending…' : 'Resend verification email'}
    </Button>
    {@render status(resendStatus)}
  </div>
{/if}

{#if settings === null}
  {#if loadError !== null}
    <div class="flex flex-col items-start gap-3">
      <p role="alert" class="text-sm text-danger">{loadError}</p>
      <Button variant="secondary" onclick={() => void load()}>Retry</Button>
    </div>
  {:else}
    <p class="text-sm text-muted">Loading preferences…</p>
  {/if}
{:else}
  <div class="flex flex-col">
    {#each TOGGLES as item (item.key)}
      <label class="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          class="size-4 accent-accent"
          checked={settings[item.key]}
          disabled={saving}
          onchange={(event) => void toggle(item.key, event.currentTarget.checked)}
        />
        <span class="text-sm">{item.label}</span>
      </label>
    {/each}
  </div>
{/if}
{@render status(saveStatus)}
