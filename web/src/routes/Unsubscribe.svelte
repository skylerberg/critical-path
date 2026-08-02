<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError, assertOk } from '../api/client';
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

  const RETRY_MESSAGE = 'Something went wrong. Please try again.';
  const DEAD_LINK_MESSAGE =
    'This link is no longer valid. Sign in to change the rest of your email settings.';

  // Nothing may be written before a human presses the button: mail security
  // scanners and browser prerenders follow the link here on their own, and
  // there is deliberately no request shape that undoes it.
  let phase = $state<'confirm' | 'working' | 'done' | 'all' | 'invalid'>('confirm');
  let kind = $state<Kind | null>(null);
  let stoppingAll = $state(false);
  let error = $state<string | null>(null);

  onMount(() => {
    if (token === undefined || token === '') {
      phase = 'invalid';
    }
  });

  async function unsubscribe(): Promise<void> {
    if (token === undefined || token === '') {
      phase = 'invalid';
      return;
    }
    error = null;
    phase = 'working';
    try {
      const data = assertOk(await api.POST('/api/auth/unsubscribe', { body: { token } }));
      kind = data.kind;
      phase = 'done';
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        phase = 'invalid';
      } else {
        phase = 'confirm';
        error = RETRY_MESSAGE;
      }
    }
  }

  async function stopAll(): Promise<void> {
    if (token === undefined || token === '') return;
    error = null;
    stoppingAll = true;
    try {
      assertOk(await api.POST('/api/auth/unsubscribe/all', { body: { token } }));
      phase = 'all';
    } catch (err) {
      // The single unsubscribe already committed, so its result outranks this
      // failure and stays on screen. A dead token says so instead of inviting a
      // retry that can only fail the same way.
      error = err instanceof ApiError && err.status === 422 ? DEAD_LINK_MESSAGE : RETRY_MESSAGE;
    } finally {
      stoppingAll = false;
    }
  }
</script>

<main class="flex min-h-dvh items-center justify-center p-4">
  <div class="w-full max-w-sm rounded-lg border border-edge bg-surface p-6">
    <h1 class="text-xl font-semibold">{APP_NAME}</h1>
    <p class="mt-1 text-sm text-muted">Email preferences</p>

    {#if phase === 'confirm'}
      <p class="mt-6 text-sm">Stop sending you these notification emails?</p>
      <div class="mt-4">
        <Button onclick={unsubscribe}>Unsubscribe</Button>
      </div>
    {:else if phase === 'working'}
      <p class="mt-6 text-sm text-muted">Updating your preferences…</p>
    {:else if phase === 'invalid'}
      <p role="alert" class="mt-6 text-sm text-danger">This unsubscribe link isn't valid.</p>
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

    {#if error !== null}
      <p role="alert" class="mt-4 text-sm text-danger">{error}</p>
    {/if}

    <p class="mt-6 text-center text-sm text-muted">
      <a use:link href="/" class="font-medium text-accent hover:underline">Go to {APP_NAME}</a>
    </p>
  </div>
</main>
