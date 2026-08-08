<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { displayName, type User } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';
  import ColorDot from './ui/ColorDot.svelte';

  interface Props {
    assignees: User[];
    // Hands focus back to the search box: the panel belongs to that box, so
    // stepping off the top of the list — or pressing Escape — returns there.
    onexit: () => void;
  }

  let { assignees, onexit }: Props = $props();

  const uid = $props.id();
  const labelsHeadingId = `${uid}-labels`;
  const assigneesHeadingId = `${uid}-assignees`;

  let rootEl = $state<HTMLDivElement>();

  const labelCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const task of board.tasks) {
      for (const id of task.label_ids) {
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return counts;
  });

  const assigneeCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const task of board.tasks) {
      for (const id of task.assignee_ids) {
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return counts;
  });

  // Both sections rove as one list, so the arrows never dead-end on a heading.
  function options(): HTMLElement[] {
    return [...(rootEl?.querySelectorAll<HTMLElement>('[data-filter-option]') ?? [])];
  }

  export function focusFirst(): void {
    options()[0]?.focus();
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      // Claiming Escape here is what makes the first press step back to the box
      // and the second — pressed there — close the panel.
      event.preventDefault();
      event.stopPropagation();
      onexit();
      return;
    }
    const items = options();
    const from = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[Math.min(items.length - 1, from + 1)]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (from <= 0) {
        onexit();
      } else {
        items[from - 1]?.focus();
      }
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  // A pointer toggle must not pull the caret out of the search box, which is
  // what keeps the panel open and the typing going.
  function onmousedown(event: MouseEvent): void {
    event.preventDefault();
  }

  const rowClass =
    'flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium hover:bg-accent-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';
  const headingClass = 'px-3 text-xs font-semibold uppercase text-muted';
</script>

<div bind:this={rootEl} class="flex flex-col gap-3">
  {#if board.labels.length > 0}
    <div role="group" aria-labelledby={labelsHeadingId} class="flex flex-col gap-1">
      <p id={labelsHeadingId} class={headingClass}>Labels</p>
      {#each board.labels as label (label.id)}
        {@const selected = board.filterLabelIds.includes(label.id)}
        <button
          type="button"
          data-filter-option
          aria-pressed={selected}
          onclick={() => board.toggleLabelFilter(label.id)}
          {onmousedown}
          {onkeydown}
          class="{rowClass} {selected ? 'text-accent-strong' : 'text-ink'}"
        >
          <ColorDot color={label.color} size="sm" />
          <span class="min-w-0 flex-1 truncate">{label.name}</span>
          <span class="text-xs text-muted">{labelCounts[label.id] ?? 0}</span>
          {#if selected}
            <span aria-hidden="true">✓</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
  {#if assignees.length > 0}
    <div role="group" aria-labelledby={assigneesHeadingId} class="flex flex-col gap-1">
      <p id={assigneesHeadingId} class={headingClass}>Assignees</p>
      {#each assignees as user (user.id)}
        {@const selected = board.filterAssigneeIds.includes(user.id)}
        <button
          type="button"
          data-filter-option
          aria-pressed={selected}
          onclick={() => board.toggleAssigneeFilter(user.id)}
          {onmousedown}
          {onkeydown}
          class="{rowClass} {selected ? 'text-accent-strong' : 'text-ink'}"
        >
          <Avatar name={user.name} src={user.avatar_url} size="sm" />
          <span class="min-w-0 flex-1 truncate">{displayName(user)}</span>
          <span class="text-xs text-muted">{assigneeCounts[user.id] ?? 0}</span>
          {#if selected}
            <span aria-hidden="true">✓</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
