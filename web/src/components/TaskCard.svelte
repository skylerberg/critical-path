<script lang="ts">
  import { board } from '../lib/board.svelte';
  import type { BoardLabel, BoardTask } from '../lib/board-types';
  import { link } from '../lib/router.svelte';
  import { selection } from '../lib/selection.svelte';
  import { users } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';
  import ColorDot from './ui/ColorDot.svelte';

  interface Props {
    task: BoardTask;
    projectId: string;
    labels?: BoardLabel[];
    blockedCount?: number;
    dimmed?: boolean;
  }

  let { task, projectId, labels = [], blockedCount = 0, dimmed = false }: Props = $props();

  const assignees = $derived(task.assignee_ids.map((id) => users.displayFor(id)));
  const selected = $derived(selection.selectedTaskId === task.id);
</script>

<a
  use:link
  href={`/projects/${projectId}/tasks/${task.id}`}
  draggable="false"
  onpointerenter={() => {
    if (!board.dragging) {
      selection.set(task.id);
    }
  }}
  class="block min-h-11 rounded-md border bg-canvas p-3 transition-opacity hover:border-accent {selected
    ? 'border-accent ring-2 ring-accent'
    : 'border-edge'} {dimmed ? 'opacity-30' : ''}"
>
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
  {#if blockedCount > 0 || task.image_count > 0 || assignees.length > 0}
    <div class="mt-2 flex items-center gap-3">
      {#if blockedCount > 0}
        <span
          class="inline-flex items-center gap-1 text-xs font-medium text-danger"
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
          class="inline-flex items-center gap-1 text-xs text-muted"
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
      {#if assignees.length > 0}
        <span class="ml-auto flex -space-x-1.5">
          {#each assignees as assignee (assignee.id)}
            <Avatar name={assignee.name} size="sm" />
          {/each}
        </span>
      {/if}
    </div>
  {/if}
</a>
