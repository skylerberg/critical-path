<script lang="ts">
  import { onMount } from 'svelte';
  import { api, assertOk } from '../api/client';
  import type { components } from '../api/api.generated';
  import { APP_NAME } from '../lib/constants';
  import { link } from '../lib/router.svelte';
  import Button from '../components/ui/Button.svelte';

  interface Props {
    token?: string;
  }

  let { token }: Props = $props();

  type Kind = components['schemas']['UnsubscribeResponse']['kind'];

  const KIND_COPY: Record<Kind, string> = {
    task_assigned: "You'll no longer get email when someone assigns you a task.",
    added_to_project: "You'll no longer get email when someone adds you to a board.",
  };

  let phase = $state<'working' | 'done' | 'all' | 'invalid'>('working');
  let kind = $state<Kind | null>(null);
  let stoppingAll = $state(false);

  onMount(() => {
    void unsubscribe();
  });

  async function unsubscribe(): Promise<void> {
    if (token === undefined || token === '') {
      phase = 'invalid';
      return;
    }
    try {
      const data = assertOk(await api.POST('/api/auth/unsubscribe', { body: { token } }));
      kind = data.kind;
      phase = 'done';
    } catch {
      phase = 'invalid';
    }
  }

  async function stopAll(): Promise<void> {
    if (token === undefined || token === '') return;
    stoppingAll = true;
    try {
      assertOk(await api.POST('/api/auth/unsubscribe/all', { body: { token } }));
      phase = 'all';
    } catch {
      phase = 'invalid';
    } finally {
      stoppingAll = false;
    }
  }
</script>

<main class="flex min-h-dvh items-center justify-center p-4">
  <div class="w-full max-w-sm rounded-lg border border-edge bg-surface p-6">
    <h1 class="text-xl font-semibold">{APP_NAME}</h1>
    <p class="mt-1 text-sm text-muted">Email preferences</p>

    {#if phase === 'working'}
      <p class="mt-6 text-sm text-muted">Updating your preferences…</p>
    {:else if phase === 'invalid'}
      <p role="alert" class="mt-6 text-sm text-danger">This link is no longer valid.</p>
    {:else if phase === 'all'}
      <p role="status" class="mt-6 text-sm">You'll no longer get any notification email from us.</p>
    {:else}
      <p role="status" class="mt-6 text-sm">{kind === null ? '' : KIND_COPY[kind]}</p>
      <div class="mt-4">
        <Button variant="secondary" disabled={stoppingAll} onclick={stopAll}>
          Turn off all email notifications
        </Button>
      </div>
    {/if}

    <p class="mt-6 text-center text-sm text-muted">
      <a use:link href="/" class="font-medium text-accent hover:underline">Go to {APP_NAME}</a>
    </p>
  </div>
</main>
