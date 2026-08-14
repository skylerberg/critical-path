<script lang="ts">
  import Skeleton from './ui/Skeleton.svelte';
  import { board } from '../lib/board.svelte';
  import { taskHref } from '../lib/short-links';
  import { link } from '../lib/router.svelte';
  import { truncateTitle } from '../lib/titles';
  import type { BoardTask } from '../lib/board-types';
  import type { CrossProjectDependency } from '../lib/crossProjectDeps.svelte';
  import type { DependencyDirection } from '../lib/dependency-types';

  interface Props {
    taskId: string;
    direction: DependencyDirection;
    /** Same-project edges, resolved against the open board. */
    local: BoardTask[];
    /** Edges into other projects the viewer may read. */
    remote: CrossProjectDependency[];
    /** Edges into projects the viewer may not read — counted, never named. */
    hiddenCount: number;
    /** Placeholder rows to hold while the remote list is in flight. */
    skeletonCount: number;
    loading: boolean;
    doneColumnIds: ReadonlySet<string>;
    readonly?: boolean;
  }

  let {
    taskId,
    direction,
    local,
    remote,
    hiddenCount,
    skeletonCount,
    loading,
    doneColumnIds,
    readonly = false,
  }: Props = $props();

  const label = $derived(direction === 'blocker' ? 'Blocked by' : 'Blocks');

  const rowClass = 'flex min-h-11 items-center gap-2';
  const titleClass = 'min-w-0 flex-1 truncate text-sm';
  const removeClass =
    'flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted hover:bg-accent-soft hover:text-danger focus-ring-flush';

  // The row unmounts on the optimistic update, taking the button that was just
  // activated with it, so focus is handed to a neighbouring row first — a remote
  // row's link counts, since it is the next thing in the list either way.
  function focusNeighborOf(row: Element): void {
    const rows = Array.from(row.parentElement?.children ?? []);
    const at = rows.indexOf(row);
    for (const sibling of [...rows.slice(at + 1), ...rows.slice(0, at).reverse()]) {
      const control = sibling.querySelector<HTMLElement>('button, a[href]');
      if (control !== null) {
        control.focus();
        return;
      }
    }
  }

  function removeLocal(otherId: string, event: MouseEvent): void {
    const row = (event.currentTarget as HTMLElement).closest('li');
    if (row !== null) {
      focusNeighborOf(row);
    }
    // The picker's direction convention, mirrored: a blocker is removed from
    // this task, a dependent has this task removed from it.
    void (direction === 'blocker'
      ? board.removeBlocker(taskId, otherId)
      : board.removeBlocker(otherId, taskId));
  }
</script>

{#if local.length > 0 || remote.length > 0 || hiddenCount > 0 || skeletonCount > 0}
  <ul aria-label={label} aria-busy={loading} class="flex flex-col">
    {#each local as task (task.id)}
      <li class={rowClass}>
        <span
          class="{titleClass} {doneColumnIds.has(task.column_id) ? 'text-muted line-through' : ''}"
        >
          {truncateTitle(task.title)}
        </span>
        {#if !readonly}
          <button
            type="button"
            aria-label="Remove {direction === 'blocker'
              ? 'blocking'
              : 'blocked'} task {truncateTitle(task.title)}"
            onclick={(event) => removeLocal(task.id, event)}
            class={removeClass}
          >
            Remove
          </button>
        {/if}
      </li>
    {/each}

    <!-- No Remove on a remote row: removeBlocker patches blocker_ids optimistically,
         which never holds a cross-project id, so the button would appear to do
         nothing. Detaching one is an API/CLI action until it has its own path. -->
    {#each remote as edge (edge.task_id)}
      <li class={rowClass}>
        <a
          use:link
          href={taskHref(edge.task_id, edge.title)}
          class="{titleClass} hover:underline focus-ring-flush {edge.is_done
            ? 'text-muted line-through'
            : ''}"
        >
          {truncateTitle(edge.title)}
        </a>
        <span class="shrink-0 truncate text-xs text-muted">{edge.project_name}</span>
      </li>
    {/each}

    <!-- "other projects" rather than "another project" in the plural: claiming
         they share one would itself say something about them. -->
    {#if hiddenCount > 0}
      <li class="flex min-h-11 items-center">
        <span class="text-sm text-muted">
          {hiddenCount === 1
            ? '1 task in another project'
            : `${hiddenCount} tasks in other projects`}
        </span>
      </li>
    {/if}

    {#each Array.from({ length: skeletonCount }, (_, index) => index) as index (index)}
      <li class={rowClass} aria-hidden="true">
        <Skeleton class="h-4 w-40" />
        <Skeleton class="h-3 w-20" />
      </li>
    {/each}
  </ul>
{/if}
