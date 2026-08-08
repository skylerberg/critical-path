<script lang="ts">
  import { onMount } from 'svelte';
  import { api, assertOk } from '../api/client';
  import type { components } from '../api/api.generated';
  import { apiMessage } from '../lib/apiMessages';
  import { session } from '../lib/session.svelte';
  import Button from './ui/Button.svelte';
  import OfflineNotice from './OfflineNotice.svelte';

  type Settings = components['schemas']['NotificationSettings'];
  type Status = { kind: 'success' | 'error'; message: string } | null;

  const TOGGLES = [
    { key: 'task_assigned', label: 'When someone assigns me a task' },
    { key: 'bulk_task_assigned', label: 'When someone assigns me several cards at once' },
    { key: 'mentioned', label: 'When someone mentions me' },
    { key: 'added_to_project', label: 'When someone adds me to a board' },
  ] as const;

  let settings = $state<Settings | null>(null);
  let loadError = $state<string | null>(null);
  let saveStatus = $state<Status>(null);
  let saving = $state(false);

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
    settings = { ...settings, [key]: checked };
    saving = true;
    saveStatus = null;
    try {
      // The one preference that moved, not the set this tab happens to hold: a
      // tab left open across a release that adds a kind would otherwise write
      // back its own stale idea of the others.
      settings = assertOk(
        await api.PUT('/api/auth/me/notification-settings', { body: { [key]: checked } })
      );
      saveStatus = { kind: 'success', message: 'Preferences saved' };
    } catch (error) {
      saveStatus = { kind: 'error', message: apiMessage(error) };
      await load();
    } finally {
      saving = false;
    }
  }
</script>

<OfflineNotice />

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
  <p class="text-sm text-muted">These emails are on hold until your address is verified.</p>
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
