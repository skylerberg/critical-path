<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { projects } from '../lib/projects.svelte';
  import { session } from '../lib/session.svelte';
  import { users, type User } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';
  import Input from './ui/Input.svelte';

  interface Props {
    projectId: string;
  }

  let { projectId }: Props = $props();

  const MAX_SUGGESTIONS = 8;
  // A bare "@" is not enough to offer an invite: a partial address is rejected on submit.
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  let query = $state('');
  let highlighted = $state(0);
  let error = $state('');
  let notice = $state<{ message: string; pending: boolean } | null>(null);
  let inviting = $state(false);
  let listEl = $state<HTMLDivElement>();
  let inputEl = $state<HTMLInputElement | null>(null);
  const addedIds = new SvelteSet<string>();

  const project = $derived(projects.projects.find((p) => p.id === projectId));
  const excludedIds = $derived(
    new Set(
      [...(project?.member_ids ?? []), project?.created_by, session.user?.id].filter(
        (id) => id != null
      )
    )
  );
  const needle = $derived(query.trim().toLowerCase());
  // People added in this session stay listed (as a done row) so the row under the
  // pointer or the Enter key never changes identity mid-gesture.
  const pool = $derived(
    users.users.filter((user) => !excludedIds.has(user.id) || addedIds.has(user.id))
  );
  const candidates = $derived(
    pool
      .filter((user) => needle === '' || user.name.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS)
  );
  // Two people sharing a name render identically down to the avatar colour, and
  // picking the wrong one grants board access to a stranger.
  const ambiguousIds = $derived(
    new Set(
      candidates
        .filter((user) =>
          candidates.some(
            (other) => other.id !== user.id && other.name.toLowerCase() === user.name.toLowerCase()
          )
        )
        .map((user) => user.id)
    )
  );
  // Offered even for someone already listed: which addresses have accounts is
  // knowledge the server keeps, and inviting one that does is an idempotent add.
  const showInvite = $derived(EMAIL.test(needle));
  const rowCount = $derived(candidates.length + (showInvite ? 1 : 0));
  // A realtime membership change can shrink the rows under a stale highlight.
  const activeIndex = $derived(Math.max(0, Math.min(highlighted, rowCount - 1)));
  const emptyMessage = $derived.by(() => {
    if (needle !== '') {
      return 'No matching people. Enter an email address to invite someone new.';
    }
    if (users.users.some((user) => user.id !== session.user?.id)) {
      return "Everyone you've shared a board with is already here. Enter an email address to invite someone new.";
    }
    return "You haven't shared a board with anyone yet. Enter an email address to invite someone.";
  });

  function add(user: User): void {
    if (addedIds.has(user.id)) {
      return;
    }
    addedIds.add(user.id);
    query = '';
    highlighted = 0;
    error = '';
    notice = null;
    void projects.addMember(projectId, user.id);
    inputEl?.focus();
  }

  async function invite(): Promise<void> {
    if (!showInvite || inviting) {
      return;
    }
    const address = needle;
    inviting = true;
    error = '';
    notice = null;
    const result = await projects.addMemberByEmail(projectId, address);
    inviting = false;
    if (result.ok) {
      query = '';
      highlighted = 0;
      // An address is all the client knows, so naming who it reached is the only
      // way to tell an account that just joined from one that was already here.
      notice =
        result.status === 'invited'
          ? { message: `Invitation sent to ${address}`, pending: true }
          : { message: `${result.name} is on this board.`, pending: false };
    } else {
      error = result.error;
    }
    inputEl?.focus();
  }

  function activate(index: number): void {
    const user = candidates[index];
    if (user !== undefined) {
      add(user);
      return;
    }
    if (showInvite && index === candidates.length) {
      void invite();
    }
  }

  // Safe to read the DOM before Svelte re-renders: arrow keys move the highlight
  // but never change the row set.
  function revealHighlighted(): void {
    const target = listEl?.querySelectorAll('button')[activeIndex];
    target?.scrollIntoView({ block: 'nearest' });
    // Focus follows the highlight only once it is already in the list; arrowing
    // from the search field must not steal focus away from it.
    if (target !== undefined && listEl?.contains(document.activeElement) === true) {
      target.focus();
    }
  }

  function onkeydown(event: KeyboardEvent, rowIndex?: number): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlighted = Math.min(rowCount - 1, activeIndex + 1);
      revealHighlighted();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = Math.max(0, activeIndex - 1);
      revealHighlighted();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // Adding someone grants board access, so a held key must not walk down the
      // list granting it to everyone in turn.
      if (event.repeat) {
        return;
      }
      activate(rowIndex ?? activeIndex);
    }
  }

  function oninput(): void {
    highlighted = 0;
    error = '';
    notice = null;
    if (listEl !== undefined) {
      listEl.scrollTop = 0;
    }
  }

  // Runs after Modal's showModal, which would otherwise land focus on a Remove button.
  $effect(() => {
    inputEl?.focus();
  });
</script>

<div class="flex flex-col gap-2">
  <Input
    label="Add people"
    placeholder="Search by name or enter an email"
    bind:value={query}
    bind:element={inputEl}
    {error}
    {onkeydown}
    {oninput}
    autocomplete="off"
    autocapitalize="none"
    autocorrect="off"
    spellcheck="false"
  />
  <div
    bind:this={listEl}
    class="flex max-h-56 flex-col gap-1 overflow-y-auto overscroll-contain"
    role="group"
    aria-label="People to add"
  >
    {#each candidates as user, i (user.id)}
      {@const added = addedIds.has(user.id)}
      {@const shortId = ambiguousIds.has(user.id) ? user.id.slice(0, 8) : undefined}
      {@const label = shortId === undefined ? user.name : `${user.name} ${shortId}`}
      <button
        type="button"
        disabled={added}
        aria-label={added ? `${label} added` : `Add ${label}`}
        onclick={() => add(user)}
        onkeydown={(event) => onkeydown(event, i)}
        onfocus={() => (highlighted = i)}
        onpointermove={() => (highlighted = i)}
        class="flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-left text-sm {added
          ? 'cursor-default text-muted'
          : 'cursor-pointer'} {activeIndex === i && !added ? 'bg-accent-soft' : ''} {added
          ? ''
          : 'hover:bg-accent-soft'}"
      >
        <Avatar name={user.name} src={user.avatar_url} size="sm" />
        <span class="min-w-0 flex-1 truncate font-medium">{user.name}</span>
        {#if shortId !== undefined}
          <span class="shrink-0 font-mono text-xs text-muted">{shortId}</span>
        {/if}
        {#if added}
          <span class="text-xs">Added</span>
        {/if}
      </button>
    {/each}
    {#if showInvite}
      {@const index = candidates.length}
      <button
        type="button"
        disabled={inviting}
        onclick={() => void invite()}
        onkeydown={(event) => onkeydown(event, index)}
        onfocus={() => (highlighted = index)}
        onpointermove={() => (highlighted = index)}
        class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {activeIndex ===
        index
          ? 'bg-accent-soft text-ink'
          : 'text-muted hover:bg-accent-soft hover:text-ink'}"
      >
        {inviting ? 'Inviting…' : `Invite "${needle}"`}
      </button>
    {/if}
    {#if rowCount === 0}
      <p class="px-3 py-2 text-sm text-muted">{emptyMessage}</p>
    {/if}
  </div>
  {#if notice !== null}
    <p role="status" class="text-sm text-muted">
      <span class="font-medium text-ink">{notice.message}</span>
      {#if notice.pending}They join the board once they open the link and sign in.{/if}
    </p>
  {/if}
</div>
