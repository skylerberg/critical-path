<script lang="ts">
  import { api, ApiError, assertOk } from '../api/client';
  import type { components } from '../api/api.generated';
  import { apiMessage } from '../lib/apiMessages';
  import { clearMediaCaches } from '../lib/mediaCaches';
  import { projects } from '../lib/projects.svelte';
  import { realtime } from '../lib/realtime.svelte';
  import { router } from '../lib/router.svelte';
  import { session } from '../lib/session.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import Button from './ui/Button.svelte';
  import Input from './ui/Input.svelte';
  import Modal from './ui/Modal.svelte';

  type DeleteAccountConflict = components['schemas']['DeleteAccountConflict'];

  interface Props {
    open?: boolean;
    onclose: () => void;
  }

  let { open = false, onclose }: Props = $props();

  let password = $state('');
  let error = $state('');
  let blocking = $state<DeleteAccountConflict['blocking_projects']>([]);
  let deleting = $state(false);

  function close(): void {
    // Nothing can call the request back once it is in flight, so closing must
    // not pretend otherwise: a late failure would land on a reset dialog.
    if (deleting) return;
    password = '';
    error = '';
    blocking = [];
    onclose();
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    void confirm();
  }

  async function confirm(): Promise<void> {
    if (password === '' || deleting) return;
    deleting = true;
    error = '';
    blocking = [];
    // The server closes this device's socket (4401) as it revokes the
    // credentials; disconnecting first keeps the revalidation from racing the
    // local teardown.
    realtime.disconnect();
    try {
      assertOk(await api.DELETE('/api/auth/me', { body: { password } }));
      password = '';
      session.forget();
      clearMediaCaches();
      toasts.success('Your account has been deleted');
      router.navigate('/login');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Two different 401s land here — a wrong password and a dead session —
        // and this route is exempt from the global logout handler, so an
        // unrecognised message must clear the session or it never can.
        if (err.message === 'Password is incorrect') {
          error = 'Incorrect password';
        } else {
          void session.init();
        }
      } else if (err instanceof ApiError && err.status === 409) {
        error = err.message;
        // The server's list, not the derived one behind the dialog, which is
        // empty until the projects store has loaded and after a failed load.
        blocking = (err.body as Partial<DeleteAccountConflict> | null)?.blocking_projects ?? [];
        void projects.load();
      } else {
        error = apiMessage(err);
      }
      realtime.connect();
    } finally {
      deleting = false;
    }
  }
</script>

<Modal {open} title="Delete account" onclose={close}>
  <p class="text-sm text-muted">
    This deletes your account, every board you created and everything in it, your memberships and
    assignments on other people's boards, and your uploaded images. It cannot be undone.
  </p>
  <form class="mt-4" novalidate onsubmit={submit}>
    <Input
      label="Password"
      type="password"
      name="delete-account-password"
      autocomplete="current-password"
      bind:value={password}
    />
  </form>
  {#if error !== ''}
    <p role="alert" class="mt-3 text-sm text-danger">{error}</p>
  {/if}
  {#if blocking.length > 0}
    <ul class="mt-2 flex list-inside list-disc flex-col gap-1 text-sm text-muted">
      {#each blocking as project (project.id)}
        <li>{project.name}</li>
      {/each}
    </ul>
  {/if}
  {#snippet footer()}
    <Button variant="secondary" onclick={close} disabled={deleting}>Cancel</Button>
    <Button variant="danger" onclick={confirm} disabled={password === '' || deleting}>
      {deleting ? 'Deleting…' : 'Delete my account'}
    </Button>
  {/snippet}
</Modal>
