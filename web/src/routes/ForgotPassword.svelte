<script lang="ts">
  import { api, ApiError, assertOk } from '../api/client';
  import { apiMessage } from '../lib/apiMessages';
  import { APP_NAME } from '../lib/constants';
  import { link } from '../lib/router.svelte';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';

  let email = $state('');
  let emailError = $state('');
  let formError = $state('');
  let noAccount = $state(false);
  let sentTo = $state('');
  let submitting = $state(false);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (email.trim() === '') {
      emailError = 'Email is required';
      return;
    }
    emailError = '';
    formError = '';
    noAccount = false;
    submitting = true;
    const address = email.trim();
    try {
      assertOk(await api.POST('/api/auth/forgot-password', { body: { email: address } }));
      sentTo = address;
    } catch (error) {
      noAccount = error instanceof ApiError && error.status === 404;
      formError = messageFor(error);
    } finally {
      submitting = false;
    }
  }

  function messageFor(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.status === 404) {
        return 'No account exists for that email address. Check it for a typo, or try the address you signed up with.';
      }
      if (error.status === 429) {
        return 'Too many attempts. Please try again later.';
      }
      return 'Could not send a reset link. Please try again.';
    }
    return apiMessage(error);
  }
</script>

<main class="flex min-h-dvh items-center justify-center p-4">
  <div class="w-full max-w-sm rounded-lg border border-edge bg-surface p-6">
    <h1 class="text-xl font-semibold">{APP_NAME}</h1>
    <p class="mt-1 text-sm text-muted">Reset your password</p>
    {#if sentTo !== ''}
      <p role="status" class="mt-6 text-sm">We've sent a reset link to {sentTo}.</p>
    {:else}
      <form class="mt-6 flex flex-col gap-4" novalidate onsubmit={handleSubmit}>
        <Input
          label="Email"
          type="email"
          name="email"
          autocomplete="email"
          bind:value={email}
          error={emailError}
        />
        {#if formError !== ''}
          <p role="alert" class="text-sm text-danger">{formError}</p>
        {/if}
        <Button type="submit" disabled={submitting} class="w-full">Send reset link</Button>
      </form>
      {#if noAccount}
        <p class="mt-4 text-center text-sm text-muted">
          No account?
          <a use:link href="/signup" class="font-medium text-accent hover:underline">Sign up</a>
        </p>
      {/if}
    {/if}
    <p class="mt-4 text-center text-sm text-muted">
      <a use:link href="/login" class="font-medium text-accent hover:underline">Back to log in</a>
    </p>
  </div>
</main>
