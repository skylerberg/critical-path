<script lang="ts">
  import { focusOnMount } from '../lib/actions';
  import { board } from '../lib/board.svelte';
  import { ListNav } from '../lib/list-nav.svelte';
  import { heldBy, type Held } from '../lib/multi-select';
  import { selection } from '../lib/selection.svelte';
  import { users } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  let query = $state('');
  let listEl = $state<HTMLDivElement>();

  const projectId = $derived(board.currentProjectId);
  $effect(() => {
    if (projectId !== null) {
      void users.loadForProject(projectId);
    }
  });

  const ids = $derived(selection.selectedIds);
  const tasks = $derived.by(() => {
    const wanted = new Set(ids);
    return board.tasks.filter((task) => wanted.has(task.id));
  });
  const list = $derived(projectId === null ? [] : users.forProject(projectId));
  const filtered = $derived(
    list.filter((user) => user.name.toLowerCase().includes(query.trim().toLowerCase()))
  );

  // Inert rather than first: a debounced member load can insert rows while the
  // user is arrowing, and Enter assigns across every selected card.
  const nav = new ListNav({
    keys: () => filtered.map((user) => user.id),
    list: () => listEl,
    missing: 'inert',
  });

  function held(userId: string): Held {
    return heldBy(tasks, (task) => task.assignee_ids.includes(userId));
  }

  function toggle(userId: string): void {
    void board.bulkSetAssignee([...ids], userId, held(userId) !== 'all');
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
    }
  }
</script>

<Modal open title="Assignees on {ids.length} card{ids.length === 1 ? '' : 's'}" {onclose}>
  <div class="flex flex-col gap-2">
    <input
      bind:value={query}
      use:focusOnMount
      {onkeydown}
      oninput={() => nav.clear()}
      aria-label="Filter users"
      placeholder="Filter users"
      class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm focus-ring focus:border-accent"
    />
    <div
      bind:this={listEl}
      class="flex max-h-64 flex-col gap-1 overflow-y-auto"
      role="group"
      aria-label="Users"
    >
      {#each filtered as user, i (user.id)}
        {@const state = held(user.id)}
        <button
          type="button"
          data-index={i}
          aria-pressed={state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false'}
          onclick={() => toggle(user.id)}
          onpointermove={() => nav.highlight(user.id)}
          class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {nav.index ===
          i
            ? 'bg-accent-soft'
            : 'hover:bg-accent-soft'} {state === 'none' ? 'text-ink' : 'text-accent-strong'}"
        >
          <Avatar name={user.name} src={user.avatar_url} size="sm" labelled />
          <span class="min-w-0 flex-1 truncate">{user.name}</span>
          {#if state === 'all'}
            <span aria-hidden="true">✓</span>
          {:else if state === 'some'}
            <span aria-hidden="true">–</span>
          {/if}
        </button>
      {/each}
      {#if filtered.length === 0}
        <p class="px-3 py-2 text-sm text-muted">No matching users.</p>
      {/if}
    </div>
  </div>
</Modal>
