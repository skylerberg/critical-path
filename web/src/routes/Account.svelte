<script lang="ts">
  import { api, ApiError, assertOk } from '../api/client';
  import { realtime } from '../lib/realtime.svelte';
  import { session } from '../lib/session.svelte';
  import FeedbackDialog from '../components/FeedbackDialog.svelte';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';

  type Status = { kind: 'success' | 'error'; message: string } | null;

  let name = $state(session.user?.name ?? '');
  let nameStatus = $state<Status>(null);
  let savingName = $state(false);

  let email = $state(session.user?.email ?? '');
  let emailStatus = $state<Status>(null);
  let savingEmail = $state(false);

  let feedbackOpen = $state(false);

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let passwordStatus = $state<Status>(null);
  let savingPassword = $state(false);

  async function submitName(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const value = name.trim();
    if (value === '') {
      nameStatus = { kind: 'error', message: 'Name is required' };
      return;
    }
    savingName = true;
    nameStatus = null;
    try {
      const user = assertOk(await api.PATCH('/api/auth/me', { body: { name: value } }));
      session.user = user;
      name = user.name;
      nameStatus = { kind: 'success', message: 'Name updated' };
    } catch (error) {
      nameStatus = { kind: 'error', message: messageFor(error) };
    } finally {
      savingName = false;
    }
  }

  async function submitEmail(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const value = email.trim();
    if (value === '') {
      emailStatus = { kind: 'error', message: 'Email is required' };
      return;
    }
    savingEmail = true;
    emailStatus = null;
    try {
      const user = assertOk(await api.PATCH('/api/auth/me', { body: { email: value } }));
      session.user = user;
      email = user.email;
      emailStatus = { kind: 'success', message: 'Email updated' };
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 409
          ? 'That email is taken'
          : messageFor(error);
      emailStatus = { kind: 'error', message };
    } finally {
      savingEmail = false;
    }
  }

  async function submitPassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (currentPassword === '') {
      passwordStatus = { kind: 'error', message: 'Enter your current password' };
      return;
    }
    if (newPassword.length < 8) {
      passwordStatus = { kind: 'error', message: 'New password must be at least 8 characters' };
      return;
    }
    if (newPassword !== confirmPassword) {
      passwordStatus = { kind: 'error', message: 'Passwords do not match' };
      return;
    }
    savingPassword = true;
    passwordStatus = null;
    // The server closes this device's socket (4401) when it revokes the old
    // sessions; disconnecting first keeps that close from being mistaken for a
    // logout before the new token is stored.
    realtime.disconnect();
    try {
      const data = assertOk(
        await api.POST('/api/auth/change-password', {
          body: { current_password: currentPassword, new_password: newPassword },
        })
      );
      session.adopt(data.token, data.user);
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
      passwordStatus = { kind: 'success', message: 'Password changed' };
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 401
          ? 'Incorrect current password'
          : messageFor(error);
      passwordStatus = { kind: 'error', message };
    } finally {
      realtime.connect();
      savingPassword = false;
    }
  }

  function messageFor(error: unknown): string {
    if (error instanceof ApiError) {
      return error.message;
    }
    return 'Could not reach the server. Check your connection and try again.';
  }
</script>

{#snippet status(value: Status)}
  {#if value !== null}
    <p
      role={value.kind === 'error' ? 'alert' : 'status'}
      class="text-sm {value.kind === 'error' ? 'text-danger' : 'text-accent'}"
    >
      {value.message}
    </p>
  {/if}
{/snippet}

<main class="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 lg:p-8">
  <h1 class="text-2xl font-semibold">Account</h1>

  <section class="flex flex-col gap-3 rounded-lg border border-edge bg-surface p-6">
    <h2 class="text-lg font-semibold">Profile</h2>
    <form class="flex flex-col gap-3" novalidate onsubmit={submitName}>
      <Input label="Name" name="name" autocomplete="name" bind:value={name} />
      {@render status(nameStatus)}
      <div class="flex justify-end">
        <Button type="submit" disabled={savingName}>{savingName ? 'Saving…' : 'Save name'}</Button>
      </div>
    </form>
  </section>

  <section class="flex flex-col gap-3 rounded-lg border border-edge bg-surface p-6">
    <h2 class="text-lg font-semibold">Email</h2>
    <form class="flex flex-col gap-3" novalidate onsubmit={submitEmail}>
      <Input label="Email" type="email" name="email" autocomplete="email" bind:value={email} />
      {@render status(emailStatus)}
      <div class="flex justify-end">
        <Button type="submit" disabled={savingEmail}>
          {savingEmail ? 'Saving…' : 'Save email'}
        </Button>
      </div>
    </form>
  </section>

  <section class="flex flex-col gap-3 rounded-lg border border-edge bg-surface p-6">
    <h2 class="text-lg font-semibold">Password</h2>
    <form class="flex flex-col gap-3" novalidate onsubmit={submitPassword}>
      <Input
        label="Current password"
        type="password"
        name="current-password"
        autocomplete="current-password"
        bind:value={currentPassword}
      />
      <Input
        label="New password"
        type="password"
        name="new-password"
        autocomplete="new-password"
        bind:value={newPassword}
      />
      <Input
        label="Confirm new password"
        type="password"
        name="confirm-password"
        autocomplete="new-password"
        bind:value={confirmPassword}
      />
      {@render status(passwordStatus)}
      <div class="flex justify-end">
        <Button type="submit" disabled={savingPassword}>
          {savingPassword ? 'Saving…' : 'Change password'}
        </Button>
      </div>
    </form>
  </section>

  <section class="flex flex-col gap-3 rounded-lg border border-edge bg-surface p-6">
    <h2 class="text-lg font-semibold">Feedback</h2>
    <p class="text-sm text-muted">
      Spotted a bug, or is something confusing or missing? We read every message.
    </p>
    <div class="flex justify-end">
      <Button variant="secondary" onclick={() => (feedbackOpen = true)}>Send feedback</Button>
    </div>
  </section>
</main>

<FeedbackDialog open={feedbackOpen} onclose={() => (feedbackOpen = false)} />
