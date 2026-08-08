<script lang="ts">
  import { board } from '../lib/board.svelte';
  import type { BoardTask } from '../lib/board-types';
  import { truncateTitle } from '../lib/titles';
  import Badge from './ui/Badge.svelte';

  interface Props {
    taskId: string;
    readonly?: boolean;
  }

  let { taskId, readonly = false }: Props = $props();

  const taskById = $derived(new Map(board.tasks.map((t) => [t.id, t])));
  const doneColumnIds = $derived(board.doneColumnIds);
  const task = $derived(taskById.get(taskId));
  const blockers = $derived((task?.blocker_ids ?? []).flatMap((id) => taskById.get(id) ?? []));
  const openBlockerCount = $derived(
    blockers.filter((blocker) => !doneColumnIds.has(blocker.column_id)).length
  );
  const dependents = $derived(board.tasks.filter((t) => t.blocker_ids.includes(taskId)));
</script>

{#snippet list(
  rows: BoardTask[],
  removeLabel: (row: BoardTask) => string,
  remove: (id: string) => void
)}
  <ul class="flex flex-col">
    {#each rows as row (row.id)}
      <li class="flex min-h-11 items-center gap-2">
        <span
          class="min-w-0 flex-1 truncate text-sm {doneColumnIds.has(row.column_id)
            ? 'text-muted line-through'
            : ''}"
        >
          {truncateTitle(row.title)}
        </span>
        {#if !readonly}
          <button
            type="button"
            aria-label={removeLabel(row)}
            onclick={() => remove(row.id)}
            class="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted hover:bg-accent-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
          >
            Remove
          </button>
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

{#if blockers.length > 0}
  <section class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <h3 class="text-sm font-semibold text-muted">Blocked by</h3>
      {#if openBlockerCount > 0}
        <Badge variant="danger">
          {openBlockerCount} open task{openBlockerCount === 1 ? '' : 's'}
        </Badge>
      {/if}
    </div>
    {@render list(
      blockers,
      (row) => `Remove blocking task ${truncateTitle(row.title)}`,
      (id) => void board.removeBlocker(taskId, id)
    )}
  </section>
{/if}

{#if dependents.length > 0}
  <section class="flex flex-col gap-2">
    <h3 class="text-sm font-semibold text-muted">Blocks</h3>
    {@render list(
      dependents,
      (row) => `Remove blocked task ${truncateTitle(row.title)}`,
      (id) => void board.removeBlocker(id, taskId)
    )}
  </section>
{/if}
