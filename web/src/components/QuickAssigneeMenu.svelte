<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { users } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    taskId: string;
    onclose: () => void;
  }

  let { taskId, onclose }: Props = $props();

  let query = $state('');
  let highlighted = $state(0);

  const projectId = $derived(board.currentProjectId);
  $effect(() => {
    if (projectId !== null) {
      void users.loadForProject(projectId);
    }
  });

  const list = $derived(projectId === null ? [] : users.forProject(projectId));
  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const selectedIds = $derived(new Set(task?.assignee_ids ?? []));
  const filtered = $derived(
    list.filter((user) => user.name.toLowerCase().includes(query.trim().toLowerCase()))
  );

  function toggle(userId: string): void {
    const current = task?.assignee_ids ?? [];
    const next = current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId];
    void board.setTaskAssignees(taskId, next);
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
    }
  }

  const focusOnMount = (node: HTMLInputElement): void => {
    node.focus();
  };
</script>

<Modal open title="Assignees" {onclose}>
  <div class="flex flex-col gap-2">
    <input
      bind:value={query}
      use:focusOnMount
      {onkeydown}
      oninput={() => (highlighted = 0)}
      aria-label="Filter users"
      placeholder="Filter users"
      class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm outline-none focus:border-accent"
    />
    <div class="flex flex-col gap-1" role="group" aria-label="Users">
      {#each filtered as user, i (user.id)}
        <button
          type="button"
          aria-pressed={selectedIds.has(user.id)}
          onclick={() => toggle(user.id)}
          onpointermove={() => (highlighted = i)}
          class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {highlighted ===
          i
            ? 'bg-accent-soft'
            : 'hover:bg-accent-soft'} {selectedIds.has(user.id)
            ? 'text-accent-strong'
            : 'text-ink'}"
        >
          <Avatar name={user.name} size="sm" />
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
</Modal>
