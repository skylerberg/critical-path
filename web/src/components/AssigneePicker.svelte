<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { users } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';

  interface Props {
    taskId: string;
  }

  let { taskId }: Props = $props();

  const projectId = $derived(board.currentProjectId);
  $effect(() => {
    if (projectId !== null) {
      void users.loadForProject(projectId);
    }
  });

  const list = $derived(projectId === null ? [] : users.forProject(projectId));
  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const selected = $derived(new Set(task?.assignee_ids ?? []));

  function toggle(userId: string): void {
    const current = task?.assignee_ids ?? [];
    const next = current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId];
    void board.setTaskAssignees(taskId, next);
  }
</script>

{#if list.length === 0}
  <p class="text-sm text-muted">No users available.</p>
{:else}
  <div class="flex flex-wrap gap-2" role="group" aria-label="Assignees">
    {#each list as user (user.id)}
      <button
        type="button"
        aria-pressed={selected.has(user.id)}
        onclick={() => toggle(user.id)}
        class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm font-medium transition-colors {selected.has(
          user.id
        )
          ? 'border-accent bg-accent-soft text-accent-strong'
          : 'border-edge text-muted hover:border-accent hover:text-ink'}"
      >
        <Avatar name={user.name} src={user.avatar_url} size="sm" />
        {user.name}
      </button>
    {/each}
  </div>
{/if}
