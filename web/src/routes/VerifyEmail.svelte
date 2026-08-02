<script lang="ts">
  import { api, ApiError, assertOk } from '../api/client';
  import { apiMessage } from '../lib/apiMessages';
  import { APP_NAME } from '../lib/constants';
  import { link } from '../lib/router.svelte';
  import { session } from '../lib/session.svelte';
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';

  interface Props {
    token?: string;
  }

  let { token }: Props = $props();

  type Outcome =
    | { state: 'verifying' }
    | { state: 'verified' }
    | { state: 'rejected'; reason: string }
    | { state: 'failed'; reason: string };

  type Status = { kind: 'success' | 'error'; message: string } | null;

  const OFFLINE = 'Could not reach the server. Your link is still good — try again.';
  const SERVER_ERROR = 'Something went wrong on our side. Your link is still good — try again.';

  let outcome = $state<Outcome>({ state: 'verifying' });
  let resending = $state(false);
  let resendStatus = $state<Status>(null);

  const signedIn = $derived(session.status === 'authed');

  function sentence(message: string): string {
    return /[.!?…]$/.test(message) ? message : `${message}.`;
  }

  // Only the newest redemption may settle the page: the same component instance
  // serves a second link, and a slower earlier request must not land on top.
  let attempt = 0;

  async function verify(value: string | undefined): Promise<void> {
    const run = ++attempt;
    if (value === undefined || value === '') {
      outcome = { state: 'rejected', reason: 'This link is missing its verification code.' };
      return;
    }
    outcome = { state: 'verifying' };
    try {
      assertOk(await api.POST('/api/auth/verify-email', { body: { token: value } }));
      if (run !== attempt) {
        return;
      }
      outcome = { state: 'verified' };
      // The response says nothing about whose address that was, so re-reading the
      // account is the only way a signed-in visitor's own flag can catch up.
      if (session.status === 'authed') {
        await session.refresh().catch(() => {
          // Best effort: the address is verified either way.
        });
      }
    } catch (err) {
      if (run !== attempt) {
        return;
      }
      if (!(err instanceof ApiError)) {
        outcome = { state: 'failed', reason: OFFLINE };
      } else if (err.status === 422) {
        // The one message the server returns covers several causes on purpose, so
        // it is shown as written rather than expanded into a guess about which.
        outcome = { state: 'rejected', reason: sentence(apiMessage(err)) };
      } else {
        outcome = { state: 'failed', reason: SERVER_ERROR };
      }
    }
  }

  async function resend(): Promise<void> {
    resending = true;
    resendStatus = null;
    try {
      assertOk(await api.POST('/api/auth/verify-email/resend'));
      // Hedged, not "sent": the same 204 comes back with nothing sent when the
      // address is already verified.
      resendStatus = {
        kind: 'success',
        message: 'If your address still needs verifying, a new link is on its way.',
      };
    } catch (err) {
      resendStatus = { kind: 'error', message: sentence(apiMessage(err)) };
    } finally {
      resending = false;
    }
  }

  // Keyed on the prop, not run once at init: opening a second emailed link
  // reuses this instance rather than mounting a new one.
  $effect(() => {
    resendStatus = null;
    void verify(token);
  });
</script>

{#snippet onward()}
  <p class="mt-4 text-center text-sm text-muted">
    <a
      use:link
      href={signedIn ? '/' : '/login'}
      class="inline-flex min-h-11 min-w-11 items-center justify-center font-medium text-accent hover:underline"
    >
      {signedIn ? `Continue to ${APP_NAME}` : 'Log in'}
    </a>
  </p>
{/snippet}

<main class="flex min-h-dvh items-center justify-center p-4">
  <div class="w-full max-w-sm rounded-lg border border-edge bg-surface p-6">
    <h1 class="text-xl font-semibold">{APP_NAME}</h1>
    <p class="mt-1 text-sm text-muted">Email verification</p>

    {#if outcome.state === 'verifying'}
      <div class="mt-6 flex items-center gap-3">
        <span aria-hidden="true"><Spinner /></span>
        <p role="status" class="text-sm">Confirming your email address…</p>
      </div>
    {:else if outcome.state === 'verified'}
      <p role="status" class="mt-6 text-sm">That email address is verified.</p>
      {@render onward()}
    {:else if outcome.state === 'rejected'}
      <p role="alert" class="mt-6 text-sm text-danger">{outcome.reason}</p>
      {#if signedIn}
        <p class="mt-4 text-sm text-muted">Ask for a fresh link and it will arrive by email.</p>
        <div class="mt-4 flex flex-col gap-3">
          <Button onclick={resend} disabled={resending} class="w-full">Send a new link</Button>
          {#if resendStatus !== null}
            <p
              role={resendStatus.kind === 'error' ? 'alert' : 'status'}
              class="text-sm {resendStatus.kind === 'error' ? 'text-danger' : 'text-muted'}"
            >
              {resendStatus.message}
            </p>
          {/if}
        </div>
      {:else}
        <p class="mt-4 text-sm text-muted">Log in to ask for a fresh link.</p>
      {/if}
      {@render onward()}
    {:else}
      <p role="alert" class="mt-6 text-sm text-danger">{outcome.reason}</p>
      <div class="mt-4">
        <Button onclick={() => void verify(token)} class="w-full">Try again</Button>
      </div>
      {@render onward()}
    {/if}
  </div>
</main>
