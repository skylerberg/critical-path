<script lang="ts">
  import { focusIf } from '../lib/actions';
  import { board, type BoardContext } from '../lib/board.svelte';
  import { ListNav } from '../lib/list-nav.svelte';
  import { toggleMembership } from '../lib/multi-select';
  import { users } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';

  interface Props {
    taskId: string;
    ctx?: BoardContext;
    autofocus?: boolean;
    onclose?: () => void;
  }

  let { taskId, ctx = board, autofocus = false, onclose }: Props = $props();

  let query = $state('');
  let listEl = $state<HTMLDivElement>();

  const projectId = $derived(ctx.currentProjectId);
  $effect(() => {
    if (projectId !== null) {
      void users.loadForProject(projectId);
    }
  });

  const list = $derived(projectId === null ? [] : users.forProject(projectId));
  const task = $derived(ctx.tasks.find((t) => t.id === taskId));
  const selectedIds = $derived(new Set(task?.assignee_ids ?? []));
  const filtered = $derived(
    list.filter((user) => user.name.toLowerCase().includes(query.trim().toLowerCase()))
  );

  // Inert rather than first: a debounced member load can insert rows while the
  // user is arrowing, and Enter names who gets the card.
  const nav = new ListNav({
    keys: () => filtered.map((user) => user.id),
    list: () => listEl,
    missing: 'inert',
  });

  function toggle(userId: string): void {
    void ctx.setTaskAssignees(taskId, toggleMembership(task?.assignee_ids ?? [], userId));
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (nav.move(event.key === 'ArrowDown' ? 1 : -1)) {
        event.preventDefault();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (nav.activeKey !== null) {
        toggle(nav.activeKey);
      }
    } else if (event.key === 'Escape' && onclose !== undefined) {
      // Keeps Escape from closing the enclosing <dialog> or reaching the window
      // shortcuts; only the picker collapses.
      event.preventDefault();
      event.stopPropagation();
      onclose();
    }
  }
</script>

<div class="flex flex-col gap-2">
  <input
    bind:value={query}
    use:focusIf={{ active: autofocus }}
    {onkeydown}
    oninput={() => nav.clear()}
    aria-label="Filter users"
    placeholder="Filter users"
    class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm outline-none focus:border-accent"
  />
  <div
    bind:this={listEl}
    class="flex max-h-64 flex-col gap-1 overflow-y-auto overscroll-contain"
    role="group"
    aria-label="Users"
  >
    {#each filtered as user, i (user.id)}
      <button
        type="button"
        data-index={i}
        aria-pressed={selectedIds.has(user.id)}
        onclick={() => toggle(user.id)}
        onpointermove={() => nav.highlight(user.id)}
        class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {nav.index ===
        i
          ? 'bg-accent-soft'
          : 'hover:bg-accent-soft'} {selectedIds.has(user.id) ? 'text-accent-strong' : 'text-ink'}"
      >
        <Avatar name={user.name} src={user.avatar_url} size="sm" />
        <span class="min-w-0 flex-1 truncate">{user.name}</span>
        {#if selectedIds.has(user.id)}
          <span aria-hidden="true">✓</span>
        {/if}
      </button>
    {/each}
    {#if filtered.length === 0}
      <p class="px-3 py-2 text-sm text-muted">No matching users.</p>
    {/if}
  </div>
</div>
