<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { board } from '../lib/board.svelte';
  import { shortcuts } from '../lib/shortcuts.svelte';
  import { users } from '../lib/users.svelte';
  import FilterMenu from './FilterMenu.svelte';
  import Popover from './ui/Popover.svelte';

  // The whole project roster, so a member can be filtered for before anyone has
  // assigned them anything. A selected id missing from it stays listed, or an
  // active filter would have no row to unpress.
  const assignees = $derived.by(() => {
    const projectId = board.currentProjectId;
    const roster = projectId === null ? [] : users.forProject(projectId);
    const known = new Set(roster.map((user) => user.id));
    return [
      ...roster,
      ...board.filterAssigneeIds.filter((id) => !known.has(id)).map((id) => users.displayFor(id)),
    ];
  });

  const hasOptions = $derived(board.labels.length > 0 || assignees.length > 0);
  const optionCount = $derived(board.filterLabelIds.length + board.filterAssigneeIds.length);

  const uid = $props.id();
  const panelId = `${uid}-panel`;
  const hintId = `${uid}-hint`;

  let searchInput = $state<HTMLInputElement | null>(null);
  let fieldEl = $state<HTMLLabelElement>();
  let menu = $state<ReturnType<typeof FilterMenu>>();
  let open = $state(false);

  $effect(() => {
    if (!shortcuts.filterFocusRequested) {
      return;
    }
    untrack(() => {
      shortcuts.filterFocusRequested = false;
      searchInput?.focus();
      searchInput?.select();
    });
  });

  // A request raised while the bar is unmounted (board still loading) must not
  // fire a surprise focus on the next mount.
  onDestroy(() => {
    shortcuts.filterFocusRequested = false;
  });

  async function onkeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (event.key === 'Escape') {
      // blur() reports a null relatedTarget, which the popover deliberately
      // ignores, so the panel has to be closed from here.
      event.preventDefault();
      open = false;
      event.currentTarget.blur();
    } else if (event.key === 'ArrowDown' && hasOptions) {
      event.preventDefault();
      open = true;
      await tick();
      menu?.focusFirst();
    }
  }
</script>

<!-- Deliberately not `relative`: the panel measures itself against the header
     row, which is the full width of the screen. Anchored here instead, it would
     inherit the search box's width — 82px on a phone. -->
<div class="flex min-w-0 flex-1 items-center gap-2">
  <label bind:this={fieldEl} class="relative flex min-w-0 items-center">
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
      bind:this={searchInput}
      type="search"
      value={board.filterQuery}
      oninput={(event) => board.setFilterQuery(event.currentTarget.value)}
      onfocus={() => (open = hasOptions)}
      {onkeydown}
      aria-label="Filter tasks by title"
      aria-describedby={hasOptions ? hintId : undefined}
      placeholder="Filter tasks…"
      class="min-h-11 w-36 min-w-0 rounded-md border border-edge bg-canvas pl-8 text-sm outline-none focus:border-accent sm:w-48 {optionCount >
      0
        ? 'pr-9'
        : 'pr-3'}"
    />
    {#if optionCount > 0}
      <span
        aria-hidden="true"
        class="pointer-events-none absolute right-2 rounded-full bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent"
      >
        {optionCount}
      </span>
    {/if}
  </label>
  {#if hasOptions}
    <span id={hintId} class="sr-only">
      {optionCount > 0 ? `${optionCount} selected. ` : ''}Label and assignee filters open below
      while this field is focused.
    </span>
  {/if}
  {#if open && hasOptions}
    <Popover
      trigger={fieldEl}
      id={panelId}
      label="Label and assignee filters"
      autofocus={false}
      onclose={() => (open = false)}
    >
      <FilterMenu bind:this={menu} {assignees} onexit={() => searchInput?.focus()} />
    </Popover>
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
