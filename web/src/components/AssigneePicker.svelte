<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { users } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';

  interface Props {
    taskId: string;
    readonly?: boolean;
  }

  let { taskId, readonly = false }: Props = $props();

  const projectId = $derived(board.currentProjectId);
  $effect(() => {
    if (projectId !== null && !readonly) {
      void users.loadForProject(projectId);
    }
  });

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const assigned = $derived((task?.assignee_ids ?? []).map((id) => users.displayFor(id)));
  const list = $derived(
    readonly ? assigned : projectId === null ? [] : users.forProject(projectId)
  );
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
      {#if readonly}
        <span
          class="inline-flex min-h-11 items-center gap-2 rounded-full border border-edge py-1 pr-3 pl-1 text-sm font-medium text-muted"
        >
          <Avatar name={user.name} src={user.avatar_url} size="sm" />
          {user.name}
        </span>
      {:else}
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
      {/if}
    {/each}
  </div>
{/if}
