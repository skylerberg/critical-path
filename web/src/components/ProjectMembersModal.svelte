<script lang="ts">
  import { tick } from 'svelte';
  import { isProjectOwner, projects } from '../lib/projects.svelte';
  import { roleFor, type ProjectRole } from '../lib/roles';
  import { boardPath, router } from '../lib/router.svelte';
  import { session } from '../lib/session.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import { users } from '../lib/users.svelte';
  import MemberPicker from './MemberPicker.svelte';
  import Avatar from './ui/Avatar.svelte';
  import Badge from './ui/Badge.svelte';
  import Button from './ui/Button.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    projectId: string;
    onclose: () => void;
  }

  let { projectId, onclose }: Props = $props();

  const project = $derived(projects.projects.find((p) => p.id === projectId));
  const canLeave = $derived(
    session.user !== null && (project?.member_ids.includes(session.user.id) ?? false)
  );
  const isOwner = $derived(project !== undefined && isProjectOwner(project));
  // Read from the list store, not the board: this modal also opens from the
  // projects page, where no board is loaded.
  const canManage = $derived(projects.canEdit(projectId));

  let transferTargetId = $state<string | null>(null);
  let transferring = $state(false);
  let confirmEl = $state<HTMLDivElement>();
  let transferTrigger: HTMLElement | null = null;
  let confirmPublishOpen = $state(false);

  const publicUrl = $derived(
    project === undefined ? '' : `${location.origin}${boardPath(project.id, true)}`
  );

  // Reconciled against live state: the target can be removed, or the board handed
  // elsewhere, while this prompt is open.
  const transferTarget = $derived(
    transferTargetId !== null && isOwner && project?.member_ids.includes(transferTargetId) === true
      ? transferTargetId
      : null
  );

  // Membership changes publish no user event, so a collaborator added to a shared
  // board since app start is missing from the cached directory this modal reads.
  $effect(() => {
    void users.refresh().catch(() => {});
  });

  function displayName(userId: string): string {
    const name = users.displayFor(userId).name;
    return name === '' ? userId : name;
  }

  function roleOf(userId: string): ProjectRole {
    return project === undefined ? 'editor' : (roleFor(project, userId) ?? 'editor');
  }

  function changeRole(userId: string, role: string): void {
    if (project === undefined || (role !== 'editor' && role !== 'viewer')) return;
    void projects.setMemberRole(project.id, userId, role);
  }

  function removeMember(userId: string): void {
    if (project === undefined) return;
    if (userId === transferTargetId) {
      transferTargetId = null;
    }
    void projects.setMembers(
      project.id,
      project.member_ids.filter((id) => id !== userId)
    );
  }

  async function startTransfer(userId: string, trigger: HTMLElement): Promise<void> {
    transferTargetId = userId;
    transferTrigger = trigger;
    await tick();
    confirmEl?.focus();
  }

  function cancelTransfer(): void {
    transferTargetId = null;
    transferTrigger?.focus();
    transferTrigger = null;
  }

  async function transfer(): Promise<void> {
    const targetId = transferTarget;
    if (project === undefined || targetId === null) return;
    transferring = true;
    try {
      await projects.transferOwnership(project.id, targetId);
    } finally {
      transferring = false;
      transferTargetId = null;
      transferTrigger = null;
    }
  }

  function publish(): void {
    if (project === undefined) return;
    confirmPublishOpen = false;
    void projects.setPublic(project.id, true);
  }

  function unpublish(): void {
    if (project === undefined) return;
    void projects.setPublic(project.id, false);
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toasts.success('Link copied');
    } catch {
      toasts.error('Could not copy link');
    }
  }

  function leave(): void {
    if (project === undefined) return;
    const id = project.id;
    void projects.leave(id);
    onclose();
    if (router.current.name === 'project' && router.current.params.id === id) {
      router.navigate('/');
    }
  }
</script>

{#snippet memberRow(userId: string, owner: boolean)}
  {@const name = displayName(userId)}
  <li class="flex min-h-11 items-center gap-2">
    <Avatar {name} src={users.displayFor(userId).avatar_url} size="sm" />
    <span class="min-w-0 flex-1 truncate text-sm">
      {name}{userId === session.user?.id ? ' (you)' : ''}
    </span>
    {#if owner}
      <Badge>Owner</Badge>
    {:else if canManage && userId !== session.user?.id}
      <select
        aria-label="Role for {name}"
        value={roleOf(userId)}
        onchange={(event) => changeRole(userId, event.currentTarget.value)}
        class="min-h-11 rounded-md border border-edge bg-surface px-2 text-sm outline-none focus:border-accent"
      >
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>
      {#if isOwner}
        <button
          type="button"
          aria-label="Make owner: {name}"
          onclick={(event) => void startTransfer(userId, event.currentTarget)}
          class="flex min-h-11 cursor-pointer items-center justify-center rounded-md px-2 text-sm text-muted hover:bg-accent-soft"
        >
          Make owner
        </button>
      {/if}
      <button
        type="button"
        aria-label="Remove {name}"
        onclick={() => removeMember(userId)}
        class="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-accent-soft hover:text-danger"
      >
        ✕
      </button>
    {:else if roleOf(userId) === 'viewer'}
      <Badge>Viewer</Badge>
    {/if}
  </li>
{/snippet}

{#if project !== undefined}
  <Modal open title="Share {project.name}" {onclose}>
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-2">
        <ul class="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {#if project.created_by !== null}
            {@render memberRow(project.created_by, true)}
          {/if}
          {#each project.member_ids as memberId (memberId)}
            {@render memberRow(memberId, false)}
          {/each}
        </ul>
        {#if canManage}
          <MemberPicker {projectId} />
        {/if}
      </div>

      {#if canManage || project.is_public}
        <div class="flex flex-col gap-2 border-t border-edge pt-4">
          <h3 class="text-sm font-semibold">Public link</h3>
          {#if project.is_public}
            <p class="text-sm text-muted">
              Anyone with this link can view this board without an account.
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <input
                readonly
                aria-label="Public link"
                value={publicUrl}
                onfocus={(event) => event.currentTarget.select()}
                class="min-h-11 min-w-0 flex-1 rounded-md border border-edge bg-canvas px-3 text-sm outline-none"
              />
              <Button variant="secondary" onclick={() => void copyLink()}>Copy link</Button>
            </div>
            {#if canManage}
              <Button variant="danger" class="self-start" onclick={unpublish}>Stop sharing</Button>
            {/if}
          {:else}
            <p class="text-sm text-muted">
              Anyone with the link can view this board without an account.
            </p>
            <Button class="self-start" onclick={() => (confirmPublishOpen = true)}>
              Publish read-only link
            </Button>
          {/if}
        </div>
      {/if}

      {#if transferTarget !== null}
        <!-- Focused on open: this sits below the member list and the picker, so on a
             short viewport it would otherwise appear off-screen and unannounced. -->
        <div
          bind:this={confirmEl}
          role="group"
          tabindex="-1"
          aria-labelledby="transfer-confirm-prompt"
          class="flex flex-col gap-2 border-t border-edge pt-4"
        >
          <p id="transfer-confirm-prompt" class="text-sm text-muted">
            Make {displayName(transferTarget)} the owner? You become an ordinary member and can then leave
            this board.
          </p>
          <div class="flex gap-2">
            <Button onclick={transfer} disabled={transferring}>Transfer ownership</Button>
            <Button variant="secondary" disabled={transferring} onclick={cancelTransfer}
              >Cancel</Button
            >
          </div>
        </div>
      {:else if isOwner}
        <div class="flex flex-col gap-2 border-t border-edge pt-4">
          <p class="text-sm text-muted">
            Owners can't leave a board. Make someone else the owner first.
          </p>
        </div>
      {:else if canLeave}
        <div class="flex flex-col gap-2 border-t border-edge pt-4">
          <p class="text-sm text-muted">
            Leaving removes your access to this board and unassigns your tasks.
          </p>
          <Button variant="danger" class="self-start" onclick={leave}>Leave board</Button>
        </div>
      {/if}
    </div>
  </Modal>

  {#if confirmPublishOpen}
    <Modal open title="Publish read-only link" onclose={() => (confirmPublishOpen = false)}>
      <p class="text-sm text-muted">
        Publish <strong class="text-ink">{project.name}</strong>? Anyone with the link will be able
        to see every card title, every description, every image on those cards, and who is assigned
        — including cards in done columns — without an account or a password. The link is unlisted:
        it is never listed anywhere and search engines are told not to index it, but anyone you send
        it to can pass it on. You can stop sharing at any time.
      </p>
      {#snippet footer()}
        <Button variant="secondary" onclick={() => (confirmPublishOpen = false)}>Cancel</Button>
        <Button onclick={publish}>Publish read-only link</Button>
      {/snippet}
    </Modal>
  {/if}
{/if}
