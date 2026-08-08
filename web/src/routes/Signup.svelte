<script lang="ts">
  import { ApiError } from '../api/client';
  import { apiMessage } from '../lib/apiMessages';
  import { authForm } from '../lib/authForm.svelte';
  import { APP_NAME } from '../lib/constants';
  import { link, router } from '../lib/router.svelte';
  import { consumeIntendedPath, session } from '../lib/session.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';

  let nameError = $state('');
  let emailError = $state('');
  let passwordError = $state('');
  let formError = $state('');
  let submitting = $state(false);

  function validatePassword(value: string): string {
    if (value === '') {
      return 'Password is required';
    }
    if (value.length < 8) {
      return 'Password must be at least 8 characters';
    }
    return '';
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    nameError = authForm.name.trim() === '' ? 'Name is required' : '';
    emailError = authForm.email.trim() === '' ? 'Email is required' : '';
    passwordError = validatePassword(authForm.password);
    formError = '';
    if (nameError !== '' || emailError !== '' || passwordError !== '') {
      return;
    }
    submitting = true;
    try {
      await session.signup(authForm.name.trim(), authForm.email.trim(), authForm.password);
      authForm.clear();
      router.redirect(consumeIntendedPath());
      // A toast rather than something to dismiss on this screen: the account is
      // usable immediately, so nothing should stand between signing up and the app.
      toasts.info(
        'Check your inbox to verify your email address. You can send a fresh link from your account.',
        10_000
      );
    } catch (error) {
      formError = messageFor(error);
    } finally {
      submitting = false;
    }
  }

  function messageFor(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.status === 409) {
        return 'An account with this email already exists';
      }
      if (error.status === 403) {
        return 'Sign-ups are currently disabled';
      }
      if (error.status === 429) {
        return 'Too many attempts. Wait a minute and try again.';
      }
      return error.message;
    }
    return apiMessage(error);
  }
</script>

<main class="flex min-h-dvh items-center justify-center p-4">
  <div class="w-full max-w-sm rounded-lg border border-edge bg-surface p-6">
    <h1 class="text-xl font-semibold">{APP_NAME}</h1>
    <p class="mt-1 text-sm text-muted">Create your account</p>
    <form class="mt-6 flex flex-col gap-4" novalidate onsubmit={handleSubmit}>
      <Input
        label="Name"
        type="text"
        name="name"
        autocomplete="name"
        bind:value={authForm.name}
        error={nameError}
      />
      <Input
        label="Email"
        type="email"
        name="email"
        autocomplete="email"
        bind:value={authForm.email}
        error={emailError}
      />
      <Input
        label="Password"
        type="password"
        name="password"
        autocomplete="new-password"
        bind:value={authForm.password}
        error={passwordError}
      />
      {#if formError !== ''}
        <p role="alert" class="text-sm text-danger">{formError}</p>
      {/if}
      <Button type="submit" disabled={submitting} class="w-full">Sign up</Button>
    </form>
    <p class="mt-4 text-center text-sm text-muted">
      Already have an account?
      <a use:link href="/login" class="font-medium text-accent hover:underline">Log in</a>
    </p>
  </div>
</main>
