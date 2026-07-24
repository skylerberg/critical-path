<script lang="ts">
  import { untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import {
    dndzone,
    dragHandleZone,
    SHADOW_PLACEHOLDER_ITEM_ID,
    TRIGGERS,
    type DndEvent,
  } from 'svelte-dnd-action';
  import { board, positionAfterDrop } from '../lib/board.svelte';
  import type { BoardColumn, BoardLabel, BoardTask } from '../lib/board-types';
  import { users } from '../lib/users.svelte';
  import { shortcuts } from '../lib/shortcuts.svelte';
  import ColumnHeader from '../components/ColumnHeader.svelte';
  import QuickAddTask from '../components/QuickAddTask.svelte';
  import TaskCard from '../components/TaskCard.svelte';
  import Button from '../components/ui/Button.svelte';

  interface Props {
    projectId: string;
  }

  let { projectId }: Props = $props();

  const FLIP_MS = 150;
  const TOUCH_DRAG_DELAY_MS = 250;
  const dropTargetStyle = { outline: '2px solid var(--cp-accent)', outlineOffset: '-2px' };

  let localColumns = $state<BoardColumn[]>([]);
  let localTasks = $state<Record<string, BoardTask[]>>({});
  let columnDragging = $state(false);
  let taskDragging = $state(false);
  let addingColumn = $state(false);
  let newColumnName = $state('');

  $effect(() => {
    board.dragging = columnDragging || taskDragging;
  });

  $effect(() => {
    void users.loadForProject(projectId);
  });

  // QuickAddTask encapsulates its open/focus state, so the shortcut opens it via its trigger.
  $effect(() => {
    const columnId = shortcuts.quickAddColumn;
    if (columnId === null) {
      return;
    }
    untrack(() => {
      shortcuts.quickAddColumn = null;
      const host = document.querySelector(`[data-quick-add="${columnId}"]`);
      const input = host?.querySelector('input');
      if (input instanceof HTMLInputElement) {
        input.focus();
      } else {
        host?.querySelector('button')?.click();
      }
    });
  });

  $effect(() => {
    if (!columnDragging) {
      localColumns = [...board.columns];
    }
  });

  $effect(() => {
    if (!taskDragging) {
      const next: Record<string, BoardTask[]> = {};
      for (const column of board.columns) {
        next[column.id] = board.tasksInColumn(column.id);
      }
      localTasks = next;
    }
  });

  const labelById = $derived(new Map(board.labels.map((label) => [label.id, label])));
  const taskById = $derived(new Map(board.tasks.map((task) => [task.id, task])));
  const doneColumnIds = $derived(
    new Set(board.columns.filter((column) => column.is_done).map((column) => column.id))
  );

  function labelsFor(task: BoardTask): BoardLabel[] {
    return task.label_ids.flatMap((id) => labelById.get(id) ?? []);
  }

  function openBlockerCount(task: BoardTask): number {
    return task.blocker_ids.filter((id) => {
      const blocker = taskById.get(id);
      return blocker !== undefined && !doneColumnIds.has(blocker.column_id);
    }).length;
  }

  function handleColumnConsider(event: CustomEvent<DndEvent<BoardColumn>>): void {
    columnDragging = true;
    localColumns = event.detail.items;
  }

  function handleColumnFinalize(event: CustomEvent<DndEvent<BoardColumn>>): void {
    const items = event.detail.items.filter((column) => column.id !== SHADOW_PLACEHOLDER_ITEM_ID);
    localColumns = items;
    columnDragging = false;
    if (event.detail.info.trigger === TRIGGERS.DROPPED_INTO_ZONE) {
      void board.moveColumn(event.detail.info.id, positionAfterDrop(items, event.detail.info.id));
    }
  }

  function handleTaskConsider(columnId: string, event: CustomEvent<DndEvent<BoardTask>>): void {
    taskDragging = true;
    localTasks[columnId] = event.detail.items;
  }

  function handleTaskFinalize(columnId: string, event: CustomEvent<DndEvent<BoardTask>>): void {
    const items = event.detail.items.filter((task) => task.id !== SHADOW_PLACEHOLDER_ITEM_ID);
    localTasks[columnId] = items;
    // The origin zone's finalize (DROPPED_INTO_ANOTHER) must not end the drag: the
    // target zone's DROPPED_INTO_ZONE is the single place that commits the move.
    if (event.detail.info.trigger !== TRIGGERS.DROPPED_INTO_ANOTHER) {
      taskDragging = false;
    }
    if (event.detail.info.trigger === TRIGGERS.DROPPED_INTO_ZONE) {
      void board.moveTask(
        event.detail.info.id,
        columnId,
        positionAfterDrop(items, event.detail.info.id)
      );
    }
  }

  function submitNewColumn(event: SubmitEvent): void {
    event.preventDefault();
    const name = newColumnName.trim();
    if (name === '') {
      return;
    }
    void board.createColumn(name);
    newColumnName = '';
    addingColumn = false;
  }

  const focusOnMount = (node: HTMLInputElement): void => {
    node.focus();
  };
</script>

<div class="min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto lg:snap-none">
  <div class="flex h-full items-stretch gap-3 p-3 lg:gap-4 lg:p-4">
    <div
      class="flex items-stretch gap-3 empty:hidden lg:gap-4"
      use:dragHandleZone={{
        items: localColumns,
        type: 'column',
        flipDurationMs: FLIP_MS,
        dropTargetStyle,
        delayTouchStart: true,
        zoneItemTabIndex: -1,
      }}
      onconsider={handleColumnConsider}
      onfinalize={handleColumnFinalize}
    >
      {#each localColumns as column (column.id)}
        <section
          animate:flip={{ duration: FLIP_MS }}
          aria-label={column.name}
          class="flex max-h-full w-[85vw] max-w-72 shrink-0 snap-start snap-always flex-col rounded-lg border border-edge bg-surface"
        >
          <ColumnHeader {column} count={board.tasksInColumn(column.id).length} />
          <div
            class="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2"
            use:dndzone={{
              items: localTasks[column.id] ?? [],
              type: 'task',
              flipDurationMs: FLIP_MS,
              dropTargetStyle,
              delayTouchStart: TOUCH_DRAG_DELAY_MS,
              zoneItemTabIndex: -1,
            }}
            onconsider={(event) => handleTaskConsider(column.id, event)}
            onfinalize={(event) => handleTaskFinalize(column.id, event)}
          >
            {#each localTasks[column.id] ?? [] as task (task.id)}
              <div animate:flip={{ duration: FLIP_MS }}>
                <TaskCard
                  {task}
                  {projectId}
                  labels={labelsFor(task)}
                  blockedCount={openBlockerCount(task)}
                  dimmed={board.hasActiveFilters && !board.taskMatchesFilters(task)}
                />
              </div>
            {/each}
          </div>
          <div data-quick-add={column.id}>
            <QuickAddTask columnId={column.id} />
          </div>
        </section>
      {/each}
    </div>
    <div class="w-[85vw] max-w-72 shrink-0 snap-start snap-always">
      {#if addingColumn}
        <form
          onsubmit={submitNewColumn}
          class="flex flex-col gap-2 rounded-lg border border-edge bg-surface p-2"
        >
          <input
            bind:value={newColumnName}
            use:focusOnMount
            aria-label="Column name"
            placeholder="Column name"
            onkeydown={(event) => {
              if (event.key === 'Escape') {
                addingColumn = false;
                newColumnName = '';
              }
            }}
            class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm outline-none focus:border-accent"
          />
          <div class="flex gap-2">
            <Button type="submit" class="flex-1">Add column</Button>
            <Button
              variant="ghost"
              onclick={() => {
                addingColumn = false;
                newColumnName = '';
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      {:else}
        <button
          type="button"
          onclick={() => (addingColumn = true)}
          class="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-edge px-3 text-sm font-medium text-muted hover:border-accent hover:text-ink"
        >
          + Add column
        </button>
      {/if}
    </div>
  </div>
</div>
