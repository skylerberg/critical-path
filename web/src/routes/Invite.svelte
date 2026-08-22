<script lang="ts">
  import { untrack } from 'svelte';
  import { api, ApiError, assertOk } from '../api/client';
  import { apiMessage } from '../lib/apiMessages';
  import { APP_NAME } from '../lib/constants';
  import { projects } from '../lib/projects.svelte';
  import { link, router } from '../lib/router.svelte';
  import { projectHref } from '../lib/short-links';
  import { isSignedIn, rememberIntendedPath, session } from '../lib/session.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import Spinner from '../components/ui/Spinner.svelte';

  interface Props {
    token?: string;
  }

  let { token }: Props = $props();

  const DEAD_LINK = 'This invitation link is no longer valid.';

  let error = $state('');
  let redeemed = false;

  $effect(() => {
    if (session.status === 'unknown' || redeemed) {
      return;
    }
    redeemed = true;
    untrack(() => void redeem());
  });

  async function redeem(): Promise<void> {
    if (token === undefined || token === '') {
      error = DEAD_LINK;
      return;
    }
    // 'offline' is a signed-in session whose token init() could not check, which
    // is the ordinary state of a cold launch on a flaky network — the case a
    // mailed link arrives in. Treating it as signed out sends the visitor to
    // /login, which guardRoute then rewrites to '/' because they are signed in
    // after all, so the invitation is dropped with nothing said. Settle it first;
    // a token that turns out to be dead lands here as 'anon'.
    if (session.status === 'offline') {
      await session.revalidate();
    }
    if (!isSignedIn(session.status)) {
      rememberIntendedPath(router.path);
      router.redirect('/login');
      return;
    }
    try {
      const { project_id, role } = assertOk(
        await api.POST('/api/invitations/accept', { body: { token } })
      );
      await projects.load();
      toasts.success(
        role === 'editor'
          ? 'You have edit access to this board'
          : 'You have view-only access to this board'
      );
      const joined = projects.projects.find((entry) => entry.id === project_id);
      router.redirect(projectHref(project_id, joined?.name ?? ''));
    } catch (err) {
      error = err instanceof ApiError && err.status === 422 ? DEAD_LINK : apiMessage(err);
    }
  }
</script>

<div class="flex min-h-dvh items-center justify-center p-4">
  <div class="w-full max-w-sm rounded-lg border border-edge bg-surface p-6 text-center">
    <h1 class="text-xl font-semibold">{APP_NAME}</h1>
    {#if error === ''}
      <p class="mt-1 text-sm text-muted">Joining the board…</p>
      <div class="mt-6 flex justify-center">
        <Spinner size="lg" />
      </div>
    {:else}
      <p role="alert" class="mt-6 text-sm text-danger">{error}</p>
      <!-- Signing up with the invited address redeems the invitation on the spot,
           so the commonest way to reach a dead link is to already have access. -->
      <p class="mt-4 text-sm text-muted">
        If you have already accepted it, the board is in your list. Otherwise ask whoever invited
        you to send it again.
      </p>
      <p class="mt-4 text-sm">
        <a use:link href="/" class="font-medium text-accent hover:underline">Go to your boards</a>
      </p>
    {/if}
  </div>
</div>
