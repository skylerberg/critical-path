<script lang="ts">
  import { api, ApiError, assertOk } from '../api/client';
  import { apiMessage } from '../lib/apiMessages';
  import { downloadAccountExport } from '../lib/export';
  import { projects } from '../lib/projects.svelte';
  import { link } from '../lib/router.svelte';
  import { projectHref } from '../lib/short-links';
  import { session } from '../lib/session.svelte';
  import { users } from '../lib/users.svelte';
  import DeleteAccountDialog from '../components/DeleteAccountDialog.svelte';
  import FeedbackDialog from '../components/FeedbackDialog.svelte';
  import NotificationSettings from '../components/NotificationSettings.svelte';
  import PersonalAccessTokens from '../components/PersonalAccessTokens.svelte';
  import Sessions from '../components/Sessions.svelte';
  import Avatar from '../components/ui/Avatar.svelte';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import OfflineNotice from '../components/OfflineNotice.svelte';

  type Status = { kind: 'success' | 'error'; message: string } | null;

  let name = $state(session.user?.name ?? '');
  let nameStatus = $state<Status>(null);
  let savingName = $state(false);

  let avatarInput = $state<HTMLInputElement | null>(null);
  let avatarStatus = $state<Status>(null);
  let savingAvatar = $state(false);

  let email = $state(session.user?.email ?? '');
  let emailStatus = $state<Status>(null);
  let savingEmail = $state(false);

  let verifyStatus = $state<Status>(null);
  let sendingVerification = $state(false);

  let feedbackOpen = $state(false);
  let deleteOpen = $state(false);

  let exportStatus = $state<Status>(null);
  let exportingAccount = $state(false);

  const blockingProjects = $derived(
    projects.projects.filter(
      (project) => project.created_by === session.user?.id && project.member_ids.length > 0
    )
  );

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
      nameStatus = { kind: 'error', message: apiMessage(error) };
    } finally {
      savingName = false;
    }
  }

  async function uploadAvatar(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) {
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      avatarStatus = { kind: 'error', message: 'That image is too large (max 10 MB).' };
      return;
    }
    savingAvatar = true;
    avatarStatus = null;
    try {
      const user = assertOk(
        await api.POST('/api/auth/me/avatar', {
          body: { file: file as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.append('file', file);
            return form;
          },
        })
      );
      session.user = user;
      users.upsert(user);
      avatarStatus = { kind: 'success', message: 'Profile image updated' };
    } catch (error) {
      avatarStatus = { kind: 'error', message: avatarMessageFor(error) };
    } finally {
      savingAvatar = false;
    }
  }

  async function removeAvatar(): Promise<void> {
    savingAvatar = true;
    avatarStatus = null;
    try {
      const user = assertOk(await api.DELETE('/api/auth/me/avatar'));
      session.user = user;
      users.upsert(user);
      avatarStatus = { kind: 'success', message: 'Profile image removed' };
    } catch (error) {
      avatarStatus = { kind: 'error', message: avatarMessageFor(error) };
    } finally {
      savingAvatar = false;
    }
  }

  function avatarMessageFor(error: unknown): string {
    if (error instanceof ApiError && error.status === 413) {
      return 'That image is too large (max 10 MB)';
    }
    if (error instanceof ApiError && error.status === 422) {
      return 'That file is not a supported image (PNG, JPEG, GIF, or WebP)';
    }
    return apiMessage(error);
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
          : apiMessage(error);
      emailStatus = { kind: 'error', message };
    } finally {
      savingEmail = false;
    }
  }

  async function sendVerification(): Promise<void> {
    sendingVerification = true;
    verifyStatus = null;
    try {
      assertOk(await api.POST('/api/auth/verify-email/resend'));
      // Definite, not hedged: the 204 is the same whether or not mail went out,
      // but this button exists only while this tab believes the address
      // unverified, and account_updated keeps that belief server-truth for as
      // long as the socket is up — a reconnect re-reads it.
      verifyStatus = { kind: 'success', message: 'A new link is on its way.' };
    } catch (error) {
      verifyStatus = { kind: 'error', message: apiMessage(error) };
    } finally {
      sendingVerification = false;
    }
  }

  async function exportAccount(): Promise<void> {
    exportingAccount = true;
    exportStatus = null;
    try {
      await downloadAccountExport();
      exportStatus = { kind: 'success', message: 'Your account data is on its way down.' };
    } catch (error) {
      exportStatus = { kind: 'error', message: apiMessage(error) };
    } finally {
      exportingAccount = false;
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
    try {
      assertOk(
        await api.POST('/api/auth/change-password', {
          body: { current_password: currentPassword, new_password: newPassword },
        })
      );
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
      passwordStatus = { kind: 'success', message: 'Password changed' };
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 401
          ? 'Incorrect current password'
          : apiMessage(error);
      passwordStatus = { kind: 'error', message };
    } finally {
      savingPassword = false;
    }
  }
</script>

<OfflineNotice />

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
    <h2 class="text-lg font-semibold">Profile image</h2>
    <div class="flex items-center gap-4">
      <Avatar name={session.user?.name ?? ''} src={session.user?.avatar_url} size="lg" />
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={savingAvatar} onclick={() => avatarInput?.click()}>
          {savingAvatar ? 'Saving…' : session.user?.avatar_url ? 'Replace image' : 'Upload image'}
        </Button>
        {#if session.user?.avatar_url}
          <Button variant="secondary" disabled={savingAvatar} onclick={removeAvatar}>
            Remove image
          </Button>
        {/if}
      </div>
    </div>
    {@render status(avatarStatus)}
    <input
      bind:this={avatarInput}
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      aria-label="Profile image file"
      class="hidden"
      onchange={uploadAvatar}
    />
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
    <!-- Verified is the positive test on purpose: a session that has not resolved,
         or one predating the flag, must not be told an address is confirmed. -->
    {#if session.user?.email_verified === true}
      <p class="text-sm text-muted">This address is verified.</p>
    {:else}
      <p class="text-sm text-muted">
        This address is not verified yet. Verifying it confirms we can reach you here.
      </p>
      {@render status(verifyStatus)}
      <div class="flex justify-end">
        <Button variant="secondary" disabled={sendingVerification} onclick={sendVerification}>
          {sendingVerification ? 'Sending…' : 'Send verification email'}
        </Button>
      </div>
    {/if}
  </section>

  <section class="flex flex-col gap-3 rounded-lg border border-edge bg-surface p-6">
    <h2 class="text-lg font-semibold">Password</h2>
    <p class="text-sm text-muted">
      Changing your password does not sign you out anywhere — not this device, not your others. To
      sign a device out, revoke its session under “Where you're signed in”.
    </p>
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
    <h2 class="text-lg font-semibold">Email notifications</h2>
    <p class="text-sm text-muted">
      We only email you when someone puts your name on something. Every message has an unsubscribe
      link.
    </p>
    <NotificationSettings />
  </section>

  <section class="flex flex-col gap-3 rounded-lg border border-edge bg-surface p-6">
    <h2 class="text-lg font-semibold">Where you're signed in</h2>
    <p class="text-sm text-muted">
      Every browser you signed in from has its own session. We record the browser it reported and
      when the session started and lapses — never where it connected from. Revoke any you cannot
      account for; a revoked session stops working immediately. Scripts and agents sign in with
      personal access tokens instead, so check that list below too.
    </p>
    <Sessions />
  </section>

  <section class="flex flex-col gap-3 rounded-lg border border-edge bg-surface p-6">
    <h2 class="text-lg font-semibold">Personal access tokens</h2>
    <p class="text-sm text-muted">
      Long-lived credentials for scripts, agents, and the <code>cpath</code> CLI. They have the same access
      you do and can be revoked one at a time.
    </p>
    <PersonalAccessTokens />
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

  <section class="flex flex-col gap-3 rounded-lg border border-edge bg-surface p-6">
    <h2 class="text-lg font-semibold">Your data</h2>
    <p class="text-sm text-muted">
      Download everything we hold about your account as one JSON file: your profile and notification
      settings, every session and personal access token, the feedback you have sent, and the boards
      you created or joined. Cards and images live on a board, so they come from that board's own
      export instead. Comments are not part of either export yet.
    </p>
    {@render status(exportStatus)}
    <div class="flex justify-end">
      <Button variant="secondary" disabled={exportingAccount} onclick={exportAccount}>
        {exportingAccount ? 'Preparing…' : 'Download my account data'}
      </Button>
    </div>
  </section>

  <section class="flex flex-col gap-3 rounded-lg border border-edge bg-surface p-6">
    <h2 class="text-lg font-semibold text-danger">Delete account</h2>
    <p class="text-sm text-muted">
      Deleting your account is permanent. It removes your account, every board you created and
      everything in it, your memberships and assignments on other people's boards, and the images
      you uploaded. There is no undo.
    </p>
    {#if blockingProjects.length > 0}
      <p class="text-sm text-muted">You still own boards that other people are members of:</p>
      <ul class="flex list-inside list-disc flex-col gap-1 text-sm" use:link>
        {#each blockingProjects as project (project.id)}
          <li>
            <a
              href={projectHref(project.id, project.name)}
              class="font-medium text-accent hover:underline"
            >
              {project.name}
            </a>
          </li>
        {/each}
      </ul>
      <p class="text-sm text-muted">
        Transfer these boards to another member or delete them first.
      </p>
    {/if}
    <div class="flex justify-end">
      <Button
        variant="danger"
        disabled={blockingProjects.length > 0}
        onclick={() => (deleteOpen = true)}
      >
        Delete account
      </Button>
    </div>
  </section>
</main>

<FeedbackDialog open={feedbackOpen} onclose={() => (feedbackOpen = false)} />
<DeleteAccountDialog open={deleteOpen} onclose={() => (deleteOpen = false)} />
