<script lang="ts">
  import { api, ApiError, assertOk } from '../api/client';
  import { apiMessage } from '../lib/apiMessages';
  import { projects } from '../lib/projects.svelte';
  import { realtime } from '../lib/realtime.svelte';
  import { router } from '../lib/router.svelte';
  import { session } from '../lib/session.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import Button from './ui/Button.svelte';
  import Input from './ui/Input.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    open?: boolean;
    onclose: () => void;
  }

  let { open = false, onclose }: Props = $props();

  let password = $state('');
  let error = $state('');
  let deleting = $state(false);

  // Nothing else in the app touches CacheStorage, and the service worker keeps
  // this account's avatar and board images on the device for weeks.
  function clearMediaCaches(): void {
    if (typeof caches === 'undefined') return;
    void caches.delete('api-images');
    void caches.delete('api-avatars');
  }

  function close(): void {
    password = '';
    error = '';
    onclose();
  }

  async function confirm(): Promise<void> {
    if (password === '' || deleting) return;
    deleting = true;
    error = '';
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
  <div class="mt-4">
    <Input
      label="Password"
      type="password"
      name="delete-account-password"
      autocomplete="current-password"
      bind:value={password}
    />
  </div>
  {#if error !== ''}
    <p role="alert" class="mt-3 text-sm text-danger">{error}</p>
  {/if}
  {#snippet footer()}
    <Button variant="secondary" onclick={close}>Cancel</Button>
    <Button variant="danger" onclick={confirm} disabled={password === '' || deleting}>
      {deleting ? 'Deleting…' : 'Delete my account'}
    </Button>
  {/snippet}
</Modal>
