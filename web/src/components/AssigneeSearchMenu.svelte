<script lang="ts">
  import { focusIf } from '../lib/actions';
  import { board, type BoardContext } from '../lib/board.svelte';
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
  let highlighted = $state(0);

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

  function toggle(userId: string): void {
    const current = task?.assignee_ids ?? [];
    const next = current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId];
    void ctx.setTaskAssignees(taskId, next);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlighted = Math.min(filtered.length - 1, highlighted + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = Math.max(0, highlighted - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const user = filtered[highlighted];
      if (user !== undefined) {
        toggle(user.id);
      }
    } else if (event.key === 'Escape' && onclose !== undefined) {
      // preventDefault suppresses the enclosing <dialog>'s close request so only
      // the picker collapses; stopPropagation keeps it away from window shortcuts.
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
    oninput={() => (highlighted = 0)}
    aria-label="Filter users"
    placeholder="Filter users"
    class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm outline-none focus:border-accent"
  />
  <div
    class="flex max-h-64 flex-col gap-1 overflow-y-auto overscroll-contain"
    role="group"
    aria-label="Users"
  >
    {#each filtered as user, i (user.id)}
      <button
        type="button"
        aria-pressed={selectedIds.has(user.id)}
        onclick={() => toggle(user.id)}
        onpointermove={() => (highlighted = i)}
        class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {highlighted ===
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
