<script lang="ts">
  import { onDestroy } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { ListNav } from '../lib/list-nav.svelte';
  import { projects } from '../lib/projects.svelte';
  import { SEARCH_DEBOUNCE_MS } from '../lib/search-query';
  import { session } from '../lib/session.svelte';
  import { UserSearchStore, USER_SEARCH_MIN_QUERY_LENGTH } from '../lib/userSearch.svelte';
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

  type Row =
    | { kind: 'known' | 'stranger'; key: string; user: User }
    | { kind: 'invite'; key: 'invite' };

  const directory = new UserSearchStore();

  let query = $state('');
  let error = $state('');
  let notice = $state<{ message: string; pending: boolean } | null>(null);
  let inviting = $state(false);
  let searchPending = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
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
  const strangers = $derived(
    directory.results.filter((user) => !excludedIds.has(user.id) || addedIds.has(user.id))
  );
  const strangerIds = $derived(new Set(strangers.map((user) => user.id)));
  // The server excludes everyone the directory already holds, so these overlap
  // only for the moment after adding someone, when they enter the directory.
  // The remote side keeps them, so the row they were just added from does not
  // jump groups under the pointer.
  const known = $derived(
    pool
      .filter((user) => !strangerIds.has(user.id))
      .filter((user) => needle === '' || user.name.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS)
  );

  const showInvite = $derived(EMAIL.test(needle));
  const rows = $derived<Row[]>([
    ...known.map((user) => ({ kind: 'known' as const, key: `known:${user.id}`, user })),
    ...strangers.map((user) => ({ kind: 'stranger' as const, key: `stranger:${user.id}`, user })),
    ...(showInvite ? [{ kind: 'invite' as const, key: 'invite' as const }] : []),
  ]);
  // A row the user did choose and that has since vanished leaves Enter inert
  // rather than re-pointing it at whoever now occupies that position — a debounced
  // response can insert rows while the user is arrowing, and Enter grants board
  // access.
  const nav = new ListNav({
    keys: () => rows.map((row) => row.key),
    list: () => listEl,
    missing: 'inert',
  });

  // Two people sharing a name render identically down to the avatar color, and
  // picking the wrong one grants board access to a stranger. Scoped to every
  // visible row, not to one group: a colleague and a stranger sharing a name is
  // the case the group headings disguise rather than resolve.
  const ambiguousIds = $derived.by(() => {
    const named = rows.flatMap((row) => (row.kind === 'invite' ? [] : [row.user]));
    return new Set(
      named
        .filter((user) =>
          named.some(
            (other) => other.id !== user.id && other.name.toLowerCase() === user.name.toLowerCase()
          )
        )
        .map((user) => user.id)
    );
  });

  const searching = $derived(searchPending || directory.status === 'loading');
  const statusText = $derived.by(() => {
    if (notice !== null) {
      return null;
    }
    if (searching) {
      return 'Searching…';
    }
    if (directory.status === 'error') {
      return 'Could not search everyone. Showing people you work with.';
    }
    if (rows.length > 0) {
      return directory.truncated ? 'More people matched. Keep typing to narrow it down.' : null;
    }
    if (needle === '') {
      return users.users.some((user) => user.id !== session.user?.id)
        ? 'Type a name to find someone, or enter an email address to invite them.'
        : "You haven't shared a board with anyone yet. Type a name or enter an email address.";
    }
    if (needle.length < USER_SEARCH_MIN_QUERY_LENGTH) {
      return 'Keep typing to search everyone.';
    }
    return `No one matches “${query.trim()}”. Enter an email address to invite someone new.`;
  });

  function scheduleSearch(): void {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
    }
    searchPending = true;
    searchTimer = setTimeout(() => {
      searchTimer = null;
      searchPending = false;
      void directory.run(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  function cancelSearch(): void {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    searchPending = false;
  }

  onDestroy(() => {
    cancelSearch();
    directory.reset();
  });

  function add(user: User): void {
    if (addedIds.has(user.id)) {
      return;
    }
    addedIds.add(user.id);
    query = '';
    nav.clear();
    error = '';
    notice = null;
    cancelSearch();
    void projects.addMember(projectId, user);
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
      nav.clear();
      cancelSearch();
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
    const row = rows[index];
    if (row === undefined) {
      return;
    }
    if (row.kind === 'invite') {
      void invite();
      return;
    }
    add(row.user);
  }

  function onkeydown(event: KeyboardEvent, rowIndex?: number): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (nav.move(event.key === 'ArrowDown' ? 1 : -1)) {
        event.preventDefault();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // Adding someone grants board access, so a held key must not walk down the
      // list granting it to everyone in turn.
      if (event.repeat) {
        return;
      }
      activate(rowIndex ?? nav.index);
    }
  }

  function oninput(): void {
    nav.clear();
    error = '';
    notice = null;
    scheduleSearch();
    if (listEl !== undefined) {
      listEl.scrollTop = 0;
    }
  }

  // Results landing can remove the focused row, and focus falling to <body>
  // inside a dialog is a dead end with nothing to tab from.
  $effect(() => {
    void rows;
    if (listEl !== undefined && !listEl.contains(document.activeElement)) {
      return;
    }
    if (document.activeElement === document.body) {
      inputEl?.focus();
    }
  });

  // Runs after Modal's showModal, which would otherwise land focus on a Remove button.
  $effect(() => {
    inputEl?.focus();
  });
</script>

{#snippet personRow(row: Row & { kind: 'known' | 'stranger' }, index: number)}
  {@const user = row.user}
  {@const added = addedIds.has(user.id)}
  {@const shortId = ambiguousIds.has(user.id) ? user.id.slice(0, 8) : undefined}
  {@const label = shortId === undefined ? user.name : `${user.name} ${shortId}`}
  <button
    type="button"
    data-index={index}
    disabled={added}
    aria-label={added ? `${label} added` : `Add ${label}`}
    onclick={() => add(user)}
    onkeydown={(event) => onkeydown(event, index)}
    onfocus={() => nav.highlight(row.key)}
    onpointermove={() => nav.highlight(row.key)}
    class="flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-left text-sm {added
      ? 'cursor-default text-muted'
      : 'cursor-pointer'} {nav.index === index && !added ? 'bg-accent-soft' : ''} {added
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
{/snippet}

{#snippet heading(text: string)}
  <p class="shrink-0 px-3 pt-2 text-xs font-semibold tracking-wide text-muted uppercase">
    {text}
  </p>
{/snippet}

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
    {#each rows as row, index (row.key)}
      {#if row.kind !== 'invite'}
        {#if index === 0 && row.kind === 'known'}
          {@render heading('People you work with')}
        {:else if row.kind === 'stranger' && rows[index - 1]?.kind === 'known'}
          {@render heading('Everyone else')}
        {:else if index === 0 && row.kind === 'stranger'}
          {@render heading('Everyone else')}
        {/if}
        {@render personRow(row, index)}
      {:else}
        <button
          type="button"
          data-index={index}
          disabled={inviting}
          onclick={() => void invite()}
          onkeydown={(event) => onkeydown(event, index)}
          onfocus={() => nav.highlight(row.key)}
          onpointermove={() => nav.highlight(row.key)}
          class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {nav.index ===
          index
            ? 'bg-accent-soft text-ink'
            : 'text-muted hover:bg-accent-soft hover:text-ink'}"
        >
          {inviting ? 'Inviting…' : `Invite "${needle}"`}
        </button>
      {/if}
    {/each}
  </div>
  <!-- One live region for the whole picker: a second one in the same dialog
       would announce twice, and the shell's announcer is inert while a modal is
       up so it cannot be used here at all. -->
  <p role="status" class="text-sm text-muted">
    {#if notice !== null}
      <span class="font-medium text-ink">{notice.message}</span>
      {#if notice.pending}They join the board once they open the link and sign in.{/if}
    {:else if statusText !== null}
      {statusText}
    {/if}
  </p>
</div>
