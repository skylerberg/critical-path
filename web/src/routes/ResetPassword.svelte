<script lang="ts">
  import { api, ApiError, assertOk } from '../api/client';
  import { apiMessage } from '../lib/apiMessages';
  import { authForm } from '../lib/authForm.svelte';
  import { APP_NAME } from '../lib/constants';
  import { link, router } from '../lib/router.svelte';
  import { consumeIntendedPath, session } from '../lib/session.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';

  interface Props {
    token?: string;
  }

  let { token }: Props = $props();

  let newPassword = $state('');
  let confirmPassword = $state('');
  let passwordError = $state('');
  let confirmError = $state('');
  let formError = $state('');
  let invalidToken = $state(false);
  let submitting = $state(false);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (token === undefined || token === '') {
      invalidToken = true;
      return;
    }
    // Both, rather than the first to fail: a short password that also does not
    // match otherwise reports the length, then the mismatch on the next attempt.
    passwordError = newPassword.length < 8 ? 'Password must be at least 8 characters' : '';
    confirmError = newPassword !== confirmPassword ? 'Passwords do not match' : '';
    formError = '';
    if (passwordError !== '' || confirmError !== '') {
      return;
    }
    submitting = true;
    try {
      const data = assertOk(
        await api.POST('/api/auth/reset-password', { body: { token, new_password: newPassword } })
      );
      session.adopt(data.token, data.user);
      authForm.clear();
      toasts.success('Password reset.');
      router.redirect(consumeIntendedPath());
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        invalidToken = true;
      } else {
        formError = apiMessage(err);
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
          error={passwordError}
        />
        <Input
          label="Confirm new password"
          type="password"
          name="confirm-password"
          autocomplete="new-password"
          bind:value={confirmPassword}
          error={confirmError}
        />
        {#if formError !== ''}
          <p role="alert" class="text-sm text-danger">{formError}</p>
        {/if}
        <Button type="submit" disabled={submitting} class="w-full">Reset password</Button>
      </form>
      <p class="mt-4 text-center text-sm text-muted">
        <a use:link href="/login" class="font-medium text-accent hover:underline">Back to log in</a>
      </p>
    {/if}
  </div>
</main>
