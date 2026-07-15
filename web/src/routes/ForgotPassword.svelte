<script lang="ts">
  import { api } from '../api/client';
  import { APP_NAME } from '../lib/constants';
  import { link } from '../lib/router.svelte';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';

  let email = $state('');
  let emailError = $state('');
  let submitted = $state(false);
  let submitting = $state(false);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (email.trim() === '') {
      emailError = 'Email is required';
      return;
    }
    emailError = '';
    submitting = true;
    try {
      await api.POST('/api/auth/forgot-password', { body: { email: email.trim() } });
    } catch {
      // Swallowed so a network error can't distinguish known from unknown addresses.
    } finally {
      submitting = false;
      submitted = true;
    }
  }
</script>

<main class="flex min-h-dvh items-center justify-center p-4">
  <div class="w-full max-w-sm rounded-lg border border-edge bg-surface p-6">
    <h1 class="text-xl font-semibold">{APP_NAME}</h1>
    <p class="mt-1 text-sm text-muted">Reset your password</p>
    {#if submitted}
      <p role="status" class="mt-6 text-sm">If that address exists, we've sent a reset link.</p>
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
        <Button type="submit" disabled={submitting} class="w-full">Send reset link</Button>
      </form>
    {/if}
    <p class="mt-4 text-center text-sm text-muted">
      <a use:link href="/login" class="font-medium text-accent hover:underline">Back to log in</a>
    </p>
  </div>
</main>
