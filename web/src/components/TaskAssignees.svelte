<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { displayName, users } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';

  interface Props {
    taskId: string;
    readonly?: boolean;
    // Unassigning the last person unmounts the only control this section has, so
    // the caller names the control focus should fall back to.
    onemptied?: () => void;
  }

  let { taskId, readonly = false, onemptied }: Props = $props();

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const assigned = $derived((task?.assignee_ids ?? []).map((id) => users.displayFor(id)));

  function remove(userId: string, event: MouseEvent): void {
    const pill = event.currentTarget as HTMLElement;
    const next = pill.nextElementSibling ?? pill.previousElementSibling;
    if (next instanceof HTMLElement) {
      next.focus();
    } else {
      onemptied?.();
    }
    void board.setTaskAssignees(
      taskId,
      (task?.assignee_ids ?? []).filter((id) => id !== userId)
    );
  }
</script>

<div class="flex flex-wrap items-center gap-2">
  {#each assigned as user (user.id)}
    {@const name = displayName(user)}
    {#if readonly}
      <span
        class="inline-flex min-h-11 items-center gap-2 rounded-full border border-edge py-1 pr-3 pl-1 text-sm font-medium text-muted"
      >
        <Avatar {name} src={user.avatar_url} size="sm" />
        {name}
      </span>
    {:else}
      <button
        type="button"
        aria-label="Unassign {name}"
        onclick={(event) => remove(user.id, event)}
        class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-edge py-1 pr-3 pl-1 text-sm font-medium text-muted transition-colors hover:border-danger hover:text-danger"
      >
        <Avatar {name} src={user.avatar_url} size="sm" />
        {name}
        <span aria-hidden="true">✕</span>
      </button>
    {/if}
  {/each}
</div>
