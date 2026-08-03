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

  // Promised of the address the link was mailed to, never of the account
  // behind it. A link whose address has moved on is answered exactly as a live
  // one is, so nothing here can know a row was written — but that address
  // stops getting the mail either way, which is all this may claim.
  const KIND_COPY: Record<Kind, string> = {
    task_assigned: 'This address will no longer get email when someone assigns you a task.',
    bulk_task_assigned:
      'This address will no longer get email when someone assigns you several cards at once.',
    added_to_project: 'This address will no longer get email when someone adds you to a board.',
  };

  const RETRY_MESSAGE = 'Something went wrong. Please try again.';

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
    } catch {
      // The single unsubscribe already committed, so its result outranks this
      // failure and stays on screen.
      error = RETRY_MESSAGE;
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
      <p role="status" class="mt-6 text-sm">
        This address will no longer get any notification email from us.
      </p>
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
