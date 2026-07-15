<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { users } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';
  import ColorDot from './ui/ColorDot.svelte';

  const labelCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const task of board.tasks) {
      for (const id of task.label_ids) {
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return counts;
  });

  // Selected users stay listed even when they vanish from every task, so an
  // active filter always has a visible, toggleable chip.
  const assignees = $derived.by(() => {
    const ids = [
      ...new Set([...board.tasks.flatMap((task) => task.assignee_ids), ...board.filterAssigneeIds]),
    ];
    return ids.map((id) => users.displayFor(id));
  });
</script>

{#if board.labels.length > 0 || assignees.length > 0 || board.hasActiveFilters}
  <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1" role="group" aria-label="Filters">
    {#each board.labels as label (label.id)}
      {@const selected = board.filterLabelIds.includes(label.id)}
      <button
        type="button"
        aria-pressed={selected}
        onclick={() => board.toggleLabelFilter(label.id)}
        class="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-medium {selected
          ? 'text-accent'
          : 'text-muted hover:text-ink'}"
      >
        <span
          class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 {selected
            ? 'border-accent bg-accent-soft'
            : 'border-edge bg-surface'}"
        >
          <ColorDot color={label.color} size="sm" />
          {label.name}
          <span class="opacity-70">{labelCounts[label.id] ?? 0}</span>
        </span>
      </button>
    {/each}
    {#each assignees as user (user.id)}
      {@const selected = board.filterAssigneeIds.includes(user.id)}
      <button
        type="button"
        aria-pressed={selected}
        title="Filter by {user.name}"
        onclick={() => board.toggleAssigneeFilter(user.id)}
        class="flex min-h-11 min-w-11 cursor-pointer items-center justify-center"
      >
        <span
          class="rounded-full {selected
            ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface'
            : 'opacity-70 hover:opacity-100'}"
        >
          <Avatar name={user.name} size="sm" />
        </span>
      </button>
    {/each}
    {#if board.hasActiveFilters}
      <button
        type="button"
        onclick={() => board.clearFilters()}
        class="min-h-11 cursor-pointer text-xs font-medium text-muted underline hover:text-ink"
      >
        Clear filters
      </button>
    {/if}
  </div>
{/if}
