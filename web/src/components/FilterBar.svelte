<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { users } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';
  import LabelFilterChips from './LabelFilterChips.svelte';

  // Selected users stay listed even when they vanish from every task, so an
  // active filter always has a visible, toggleable chip.
  const assignees = $derived.by(() => {
    const ids = [
      ...new Set([...board.tasks.flatMap((task) => task.assignee_ids), ...board.filterAssigneeIds]),
    ];
    return ids.map((id) => users.displayFor(id));
  });
</script>

<div class="flex min-w-0 flex-1 items-center gap-2">
  <label class="relative flex min-w-0 items-center">
    <svg
      class="pointer-events-none absolute left-2.5 size-4 text-muted"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
    <input
      type="search"
      value={board.filterQuery}
      oninput={(event) => board.setFilterQuery(event.currentTarget.value)}
      aria-label="Filter tasks by title"
      placeholder="Filter tasks…"
      class="min-h-11 w-36 min-w-0 rounded-md border border-edge bg-canvas pr-3 pl-8 text-sm outline-none focus:border-accent sm:w-48"
    />
  </label>
  {#if board.labels.length > 0 || assignees.length > 0}
    <div
      class="flex min-w-0 items-center overflow-x-auto"
      role="group"
      aria-label="Label and assignee filters"
    >
      <div class="flex w-max items-center gap-x-2 gap-y-1">
        <LabelFilterChips />
        {#each assignees as user (user.id)}
          {@const selected = board.filterAssigneeIds.includes(user.id)}
          <button
            type="button"
            aria-pressed={selected}
            title="Filter by {user.name}"
            onclick={() => board.toggleAssigneeFilter(user.id)}
            class="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center"
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
      </div>
    </div>
  {/if}
  {#if board.hasActiveFilters}
    <button
      type="button"
      onclick={() => board.clearFilters()}
      class="min-h-11 shrink-0 cursor-pointer text-xs font-medium text-muted underline hover:text-ink"
    >
      Clear filters
    </button>
  {/if}
</div>
