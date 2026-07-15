<script lang="ts">
  import { ApiError } from '../api/client';
  import { APP_NAME } from '../lib/constants';
  import { link, router } from '../lib/router.svelte';
  import { consumeIntendedPath, session } from '../lib/session.svelte';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';

  let email = $state('');
  let password = $state('');
  let emailError = $state('');
  let passwordError = $state('');
  let formError = $state('');
  let submitting = $state(false);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    emailError = email.trim() === '' ? 'Email is required' : '';
    passwordError = password === '' ? 'Password is required' : '';
    formError = '';
    if (emailError !== '' || passwordError !== '') {
      return;
    }
    submitting = true;
    try {
      await session.login(email.trim(), password);
      router.redirect(consumeIntendedPath());
    } catch (error) {
      formError = messageFor(error);
    } finally {
      submitting = false;
    }
  }

  function messageFor(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        return 'Invalid email or password';
      }
      if (error.status === 429) {
        return 'Too many attempts. Wait a minute and try again.';
      }
      return error.message;
    }
    return 'Could not reach the server. Check your connection and try again.';
  }
</script>

<main class="flex min-h-dvh items-center justify-center p-4">
  <div class="w-full max-w-sm rounded-lg border border-edge bg-surface p-6">
    <h1 class="text-xl font-semibold">{APP_NAME}</h1>
    <p class="mt-1 text-sm text-muted">Log in to your account</p>
    <form class="mt-6 flex flex-col gap-4" novalidate onsubmit={handleSubmit}>
      <Input
        label="Email"
        type="email"
        name="email"
        autocomplete="email"
        bind:value={email}
        error={emailError}
      />
      <Input
        label="Password"
        type="password"
        name="password"
        autocomplete="current-password"
        bind:value={password}
        error={passwordError}
      />
      {#if formError !== ''}
        <p role="alert" class="text-sm text-danger">{formError}</p>
      {/if}
      <Button type="submit" disabled={submitting} class="w-full">Log in</Button>
    </form>
    <p class="mt-4 text-center text-sm">
      <a use:link href="/forgot-password" class="font-medium text-accent hover:underline">
        Forgot password?
      </a>
    </p>
    <p class="mt-4 text-center text-sm text-muted">
      No account?
      <a use:link href="/signup" class="font-medium text-accent hover:underline">Sign up</a>
    </p>
  </div>
</main>
