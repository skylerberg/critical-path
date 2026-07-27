<script lang="ts">
  import { board } from '../lib/board.svelte';
  import type { BoardLabel, BoardTask } from '../lib/board-types';
  import { boardPath, link } from '../lib/router.svelte';
  import { selection } from '../lib/selection.svelte';
  import { isCalendarDate } from '../lib/dates';
  import { users } from '../lib/users.svelte';
  import DueDatePill from './DueDatePill.svelte';
  import Avatar from './ui/Avatar.svelte';
  import ColorDot from './ui/ColorDot.svelte';

  interface Props {
    task: BoardTask;
    projectId: string;
    labels?: BoardLabel[];
    blockedCount?: number;
    done?: boolean;
    dimmed?: boolean;
    readonly?: boolean;
  }

  let {
    task,
    projectId,
    labels = [],
    blockedCount = 0,
    done = false,
    dimmed = false,
    readonly = false,
  }: Props = $props();

  const assignees = $derived(task.assignee_ids.map((id) => users.displayFor(id)));
  const dated = $derived(isCalendarDate(task.due_date));
  // Coalesced despite the type: a board served by an API pod that predates comments
  // omits the field entirely.
  const commentCount = $derived(task.comment_count ?? 0);
  const selected = $derived(selection.selectedTaskId === task.id);
</script>

<!-- The card is a container with a stretched overlay link rather than one big
     anchor, so the due pill can be a real button: a button inside a link is
     invalid and unreachable by keyboard. -->
<div
  role="presentation"
  onpointerenter={() => {
    if (!board.dragging) {
      selection.set(task.id);
    }
  }}
  class="relative isolate block min-h-11 rounded-md border bg-canvas p-3 transition-opacity hover:border-accent {selected
    ? 'border-accent ring-2 ring-accent'
    : 'border-edge'} {dimmed ? 'opacity-30' : ''}"
>
  <a
    use:link
    href={`${boardPath(projectId, readonly)}/tasks/${task.id}${board.filterSearch}`}
    draggable="false"
    aria-label={task.title}
    class="absolute inset-0 rounded-md"
  ></a>
  {#if labels.length > 0}
    <div class="mb-1.5 flex flex-wrap gap-1">
      {#each labels as label (label.id)}
        <span
          class="inline-flex items-center gap-1 rounded-full border border-edge px-1.5 py-0.5 text-[10px] font-medium text-muted"
        >
          <ColorDot color={label.color} size="sm" />
          {label.name}
        </span>
      {/each}
    </div>
  {/if}
  <p class="text-sm font-medium break-words">{task.title}</p>
  {#if dated || blockedCount > 0 || task.image_count > 0 || commentCount > 0 || assignees.length > 0}
    <!-- Raised above the overlay link so the badges keep their hover tooltips and
         the pill stays clickable; with no offsets it moves nothing. The row itself
         stays transparent to the pointer and each child opts back in, so the blank
         space between badges still belongs to the link. -->
    <div class="pointer-events-none relative z-10 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <DueDatePill {task} {done} {readonly} />
      {#if blockedCount > 0}
        <span
          class="pointer-events-auto inline-flex items-center gap-1 text-xs font-medium text-danger"
          title="Blocked by {blockedCount} open task{blockedCount === 1 ? '' : 's'}"
        >
          <svg
            class="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
          </svg>
          {blockedCount}
        </span>
      {/if}
      {#if task.image_count > 0}
        <span
          class="pointer-events-auto inline-flex items-center gap-1 text-xs text-muted"
          title="{task.image_count} image{task.image_count === 1 ? '' : 's'}"
        >
          <svg
            class="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.5-3.5L6 23" />
          </svg>
          {task.image_count}
        </span>
      {/if}
      {#if commentCount > 0}
        <span
          class="pointer-events-auto inline-flex items-center gap-1 text-xs text-muted"
          title="{commentCount} comment{commentCount === 1 ? '' : 's'}"
        >
          <svg
            class="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"
            />
          </svg>
          {commentCount}
        </span>
      {/if}
      {#if assignees.length > 0}
        <span class="pointer-events-auto ml-auto flex -space-x-1.5">
          {#each assignees as assignee (assignee.id)}
            <Avatar name={assignee.name} src={assignee.avatar_url} size="sm" />
          {/each}
        </span>
      {/if}
    </div>
  {/if}
</div>
