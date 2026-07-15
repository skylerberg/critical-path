<script lang="ts">
  import { api, ApiError, assertOk } from '../api/client';
  import { APP_NAME } from '../lib/constants';
  import { link, router } from '../lib/router.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';

  interface Props {
    token?: string;
  }

  let { token }: Props = $props();

  let newPassword = $state('');
  let confirmPassword = $state('');
  let error = $state('');
  let invalidToken = $state(false);
  let submitting = $state(false);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (token === undefined || token === '') {
      invalidToken = true;
      return;
    }
    if (newPassword.length < 8) {
      error = 'Password must be at least 8 characters';
      return;
    }
    if (newPassword !== confirmPassword) {
      error = 'Passwords do not match';
      return;
    }
    error = '';
    submitting = true;
    try {
      assertOk(
        await api.POST('/api/auth/reset-password', { body: { token, new_password: newPassword } })
      );
      toasts.success('Password reset. Please log in.');
      router.redirect('/login');
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        invalidToken = true;
      } else {
        error =
          err instanceof ApiError
            ? err.message
            : 'Could not reach the server. Check your connection and try again.';
      }
      submitting = false;
    }
  }
</script>

<main class="flex min-h-dvh items-center justify-center p-4">
  <div class="w-full max-w-sm rounded-lg border border-edge bg-surface p-6">
    <h1 class="text-xl font-semibold">{APP_NAME}</h1>
    <p class="mt-1 text-sm text-muted">Choose a new password</p>
    {#if invalidToken}
      <p role="alert" class="mt-6 text-sm text-danger">This link is invalid or expired.</p>
      <p class="mt-4 text-center text-sm text-muted">
        <a use:link href="/forgot-password" class="font-medium text-accent hover:underline">
          Request a new link
        </a>
      </p>
    {:else}
      <form class="mt-6 flex flex-col gap-4" novalidate onsubmit={handleSubmit}>
        <Input
          label="New password"
          type="password"
          name="new-password"
          autocomplete="new-password"
          bind:value={newPassword}
          error={error !== '' ? error : undefined}
        />
        <Input
          label="Confirm new password"
          type="password"
          name="confirm-password"
          autocomplete="new-password"
          bind:value={confirmPassword}
        />
        <Button type="submit" disabled={submitting} class="w-full">Reset password</Button>
      </form>
      <p class="mt-4 text-center text-sm text-muted">
        <a use:link href="/login" class="font-medium text-accent hover:underline">Back to log in</a>
      </p>
    {/if}
  </div>
</main>
