<script lang="ts">
  import { untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import {
    dndzone,
    dragHandleZone,
    SHADOW_PLACEHOLDER_ITEM_ID,
    SOURCES,
    TRIGGERS,
    type DndEvent,
  } from 'svelte-dnd-action';
  import { focusIf, scrollToTopOn } from '../lib/actions';
  import { board, positionAfterDrop } from '../lib/board.svelte';
  import type { BoardColumn, BoardLabel, BoardTask } from '../lib/board-types';
  import { draftKey, drafts } from '../lib/drafts.svelte';
  import { edgeScrollSpeed } from '../lib/board-scroll';
  import { motion } from '../lib/motion.svelte';
  import { shortcuts } from '../lib/shortcuts.svelte';
  import ColumnHeader from '../components/ColumnHeader.svelte';
  import QuickAddTask from '../components/QuickAddTask.svelte';
  import TaskCard from '../components/TaskCard.svelte';
  import Button from '../components/ui/Button.svelte';

  interface Props {
    projectId: string;
    readonly?: boolean;
  }

  let { projectId, readonly = false }: Props = $props();

  const FLIP_MS = 150;
  const TOUCH_DRAG_DELAY_MS = 250;
  const dropTargetStyle = { outline: '2px solid var(--cp-accent)', outlineOffset: '-2px' };

  const flipMs = $derived(motion.reduced ? 0 : FLIP_MS);

  let localColumns = $state<BoardColumn[]>([]);
  let localTasks = $state<Record<string, BoardTask[]>>({});
  let columnDragging = $state(false);
  let taskDragging = $state(false);

  const columnKey = $derived(draftKey.addColumn(projectId));
  const newColumnName = $derived(drafts.get(columnKey));
  const addingColumn = $derived(newColumnName !== null);
  let columnFormOpenedHere = $state(false);

  const dragging = $derived(columnDragging || taskDragging);

  $effect(() => {
    board.dragging = dragging;
  });

  // --- Drag-time horizontal scrolling (Trello-style) ---
  // While a drag is in progress the board free-scrolls slowly with NO snapping,
  // then snaps to the column you dropped into. We can't lean on
  // svelte-dnd-action's built-in edge auto-scroller: it's far too fast for
  // precise placement, and under mandatory scroll-snap its per-frame scrollBy()
  // directionally snaps a whole column each tick (a fling). So while dragging we
  // hide the board from that scroller (`overflow: hidden`, which stays
  // programmatically scrollable) and turn snap off, then drive a slow,
  // edge-proximity-scaled scroll ourselves. On a pointer drop we smoothly center
  // the destination column and re-arm snap once it settles.
  const DRAG_EDGE_ZONE_PX = 80; // pointer within this band of an edge starts scrolling
  const DRAG_SCROLL_SPEED_PX_PER_S = 500; // top speed at the very edge; scales to 0 at the band's inner edge
  const DROP_CENTER_TIMEOUT_MS = 500; // fallback restore if `scrollend` never fires
  let boardScroller: HTMLElement | undefined = $state();
  // Column to center after a pointer drop. While set, snap stays off so the
  // centering slide isn't fought by scroll-snap.
  let centeringTarget = $state<string | null>(null);
  const snapActive = $derived(!dragging && centeringTarget === null);

  function nearestColumnIndex(scroller: HTMLElement): number {
    const board = scroller.getBoundingClientRect();
    const mid = board.left + board.width / 2;
    const sections = scroller.querySelectorAll<HTMLElement>('section');
    let best = 0;
    let bestDist = Infinity;
    sections.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.left + rect.width / 2 - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  function scrollToColumn(scroller: HTMLElement, index: number): void {
    const section = scroller.querySelectorAll<HTMLElement>('section')[index];
    if (!section) {
      return;
    }
    const board = scroller.getBoundingClientRect();
    const rect = section.getBoundingClientRect();
    scroller.scrollTo({
      left: scroller.scrollLeft + (rect.left + rect.width / 2 - (board.left + board.width / 2)),
      behavior: motion.reduced ? 'auto' : 'smooth',
    });
  }

  // Slow, continuous edge scroll while dragging.
  $effect(() => {
    const scroller = boardScroller;
    if (!scroller || !dragging) {
      return;
    }
    centeringTarget = null; // a new drag cancels any pending drop-center
    let pointerX: number | null = null;
    const onMove = (event: Event) => {
      const x =
        event instanceof TouchEvent ? event.touches[0]?.clientX : (event as MouseEvent).clientX;
      if (typeof x === 'number') {
        pointerX = x;
      }
    };
    // svelte-dnd-action reparents the dragged element to <body>, so touch/mouse
    // moves target it under <body> and never reach the board scroller — listen on
    // document (capture) to follow the real pointer.
    document.addEventListener('mousemove', onMove, { passive: true, capture: true });
    document.addEventListener('touchmove', onMove, { passive: true, capture: true });
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (pointerX !== null) {
        const rect = scroller.getBoundingClientRect();
        const speed = edgeScrollSpeed(
          pointerX,
          rect.left,
          rect.right,
          DRAG_EDGE_ZONE_PX,
          DRAG_SCROLL_SPEED_PX_PER_S
        );
        if (speed !== 0) {
          scroller.scrollBy(speed * dt, 0);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('touchmove', onMove, true);
    };
  });

  // On a pointer drop, slide the destination column into view, then re-arm snap.
  $effect(() => {
    const scroller = boardScroller;
    const target = centeringTarget;
    if (!scroller || dragging || target === null) {
      return;
    }
    const section = Array.from(scroller.querySelectorAll<HTMLElement>('section')).find(
      (el) => el.dataset.columnId === target
    );
    if (section) {
      const board = scroller.getBoundingClientRect();
      const rect = section.getBoundingClientRect();
      scroller.scrollTo({
        left: scroller.scrollLeft + (rect.left + rect.width / 2 - (board.left + board.width / 2)),
        behavior: motion.reduced ? 'auto' : 'smooth',
      });
    }
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      scroller.removeEventListener('scrollend', finish);
      centeringTarget = null;
    };
    scroller.addEventListener('scrollend', finish);
    const timeout = window.setTimeout(finish, DROP_CENTER_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeout);
      scroller.removeEventListener('scrollend', finish);
    };
  });

  // --- Resting swipe is paginated: at most one column per swipe ---
  // Each column has scroll-snap-stop: always (snap-always), which is meant to cap
  // a fling at one column, but it isn't honored on every mobile browser (older
  // iOS Safari in particular), so a vigorous swipe can sail past several columns.
  // As a reliable guardrail, when a native scroll settles more than one column
  // from where this gesture started, slide it back to exactly one.
  $effect(() => {
    const scroller = boardScroller;
    if (!scroller || !snapActive) {
      return;
    }
    let restIndex = nearestColumnIndex(scroller);
    let correcting = false;
    const onScrollEnd = () => {
      const index = nearestColumnIndex(scroller);
      if (correcting) {
        // this scrollend is our own correction landing — just record it
        correcting = false;
        restIndex = index;
        return;
      }
      const delta = index - restIndex;
      if (Math.abs(delta) > 1) {
        const target = restIndex + Math.sign(delta);
        restIndex = target;
        correcting = true;
        scrollToColumn(scroller, target);
      } else {
        restIndex = index;
      }
    };
    scroller.addEventListener('scrollend', onScrollEnd);
    return () => scroller.removeEventListener('scrollend', onScrollEnd);
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
        next[column.id] = board.displayTasksInColumn(column.id);
      }
      localTasks = next;
    }
  });

  const labelById = $derived(new Map(board.labels.map((label) => [label.id, label])));
  const taskById = $derived(new Map(board.tasks.map((task) => [task.id, task])));
  const doneColumnIds = $derived(board.doneColumnIds);

  function labelsFor(task: BoardTask): BoardLabel[] {
    return task.label_ids.flatMap((id) => labelById.get(id) ?? []);
  }

  function openBlockerCount(task: BoardTask): number {
    return task.blocker_ids.filter((id) => {
      const blocker = taskById.get(id);
      return blocker !== undefined && !doneColumnIds.has(blocker.column_id);
    }).length;
  }

  // Keyboard drags end with a consider event (trigger DRAG_STOPPED), not a
  // finalize, so the dragging flags must reset here too.
  function handleColumnConsider(event: CustomEvent<DndEvent<BoardColumn>>): void {
    columnDragging = event.detail.info.trigger !== TRIGGERS.DRAG_STOPPED;
    localColumns = event.detail.items;
  }

  function handleColumnFinalize(event: CustomEvent<DndEvent<BoardColumn>>): void {
    const items = event.detail.items.filter((column) => column.id !== SHADOW_PLACEHOLDER_ITEM_ID);
    localColumns = items;
    // Keyboard drags finalize on EVERY arrow press; the drag only ends with the
    // DRAG_STOPPED consider, so the flag must survive keyboard finalizes or
    // shortcuts and realtime updates fire mid-drag.
    columnDragging = event.detail.info.source === SOURCES.KEYBOARD;
    if (event.detail.info.trigger === TRIGGERS.DROPPED_INTO_ZONE) {
      if (event.detail.info.source === SOURCES.POINTER) {
        centeringTarget = event.detail.info.id;
      }
      void board.moveColumn(event.detail.info.id, positionAfterDrop(items, event.detail.info.id));
    }
  }

  function handleTaskConsider(columnId: string, event: CustomEvent<DndEvent<BoardTask>>): void {
    taskDragging = event.detail.info.trigger !== TRIGGERS.DRAG_STOPPED;
    localTasks[columnId] = event.detail.items;
  }

  function handleTaskFinalize(columnId: string, event: CustomEvent<DndEvent<BoardTask>>): void {
    const items = event.detail.items.filter((task) => task.id !== SHADOW_PLACEHOLDER_ITEM_ID);
    localTasks[columnId] = items;
    // The origin zone's finalize (DROPPED_INTO_ANOTHER) must not end the drag: the
    // target zone's DROPPED_INTO_ZONE is the single place that commits the move.
    // Keyboard finalizes fire per arrow press, so they keep the flag up too.
    if (event.detail.info.trigger !== TRIGGERS.DROPPED_INTO_ANOTHER) {
      taskDragging = event.detail.info.source === SOURCES.KEYBOARD;
    }
    if (event.detail.info.trigger === TRIGGERS.DROPPED_INTO_ZONE) {
      if (event.detail.info.source === SOURCES.POINTER) {
        centeringTarget = columnId;
      }
      void board.moveTask(
        event.detail.info.id,
        columnId,
        positionAfterDrop(items, event.detail.info.id)
      );
    }
  }

  function startNewColumn(): void {
    columnFormOpenedHere = true;
    drafts.set(columnKey, '');
  }

  function closeNewColumn(): void {
    columnFormOpenedHere = false;
    drafts.clear(columnKey);
  }

  function submitNewColumn(event: SubmitEvent): void {
    event.preventDefault();
    const name = (newColumnName ?? '').trim();
    if (name === '') {
      return;
    }
    void board.createColumn(name);
    closeNewColumn();
  }
</script>

<div
  bind:this={boardScroller}
  class="relative flex min-h-0 flex-1 flex-col overscroll-x-contain overflow-y-hidden {snapActive
    ? 'overflow-x-auto snap-x snap-mandatory lg:snap-none'
    : 'overflow-x-hidden'}"
>
  <div class="flex min-h-0 flex-1 items-stretch gap-3 p-3 lg:gap-4 lg:p-4">
    <div
      class="flex items-stretch gap-3 empty:hidden lg:gap-4"
      aria-label="Columns"
      use:dragHandleZone={{
        items: localColumns,
        type: 'column',
        flipDurationMs: flipMs,
        dropAnimationDisabled: motion.reduced,
        dropTargetStyle,
        delayTouchStart: true,
        dragDisabled: readonly,
        dropFromOthersDisabled: readonly,
      }}
      onconsider={handleColumnConsider}
      onfinalize={handleColumnFinalize}
    >
      {#each localColumns as column (column.id)}
        <section
          data-column-id={column.id}
          animate:flip={{ duration: flipMs }}
          aria-label={column.name}
          class="flex max-h-full w-[85vw] max-w-72 shrink-0 snap-center snap-always flex-col rounded-lg border border-edge bg-surface md:snap-start"
        >
          <ColumnHeader
            {column}
            {readonly}
            count={board.tasksInColumn(column.id).length}
            matchCount={board.hasActiveFilters ? board.matchingCountInColumn(column.id) : null}
          />
          <div
            class="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2"
            aria-label="{column.name} tasks"
            use:scrollToTopOn={board.filterSignature}
            use:dndzone={{
              items: localTasks[column.id] ?? [],
              type: 'task',
              flipDurationMs: flipMs,
              dropAnimationDisabled: motion.reduced,
              dropTargetStyle,
              delayTouchStart: TOUCH_DRAG_DELAY_MS,
              zoneItemTabIndex: readonly ? -1 : 0,
              dragDisabled: readonly,
              dropFromOthersDisabled: readonly,
            }}
            onconsider={(event) => handleTaskConsider(column.id, event)}
            onfinalize={(event) => handleTaskFinalize(column.id, event)}
          >
            {#each localTasks[column.id] ?? [] as task (task.id)}
              <div
                animate:flip={{ duration: flipMs }}
                data-task-id={task.id}
                aria-label={task.title}
                class="rounded-md focus-visible:outline-2 focus-visible:outline-accent"
              >
                <TaskCard
                  {task}
                  {projectId}
                  {readonly}
                  labels={labelsFor(task)}
                  blockedCount={openBlockerCount(task)}
                  done={doneColumnIds.has(task.column_id)}
                  dimmed={board.hasActiveFilters && !board.taskMatchesFilters(task)}
                />
              </div>
            {/each}
          </div>
          {#if !readonly}
            <div data-quick-add={column.id}>
              <QuickAddTask columnId={column.id} />
            </div>
          {/if}
        </section>
      {/each}
    </div>
    {#if !readonly}
      <div class="w-[85vw] max-w-72 shrink-0 snap-center snap-always md:snap-start">
        {#if addingColumn}
          <form
            onsubmit={submitNewColumn}
            class="flex flex-col gap-2 rounded-lg border border-edge bg-surface p-2"
          >
            <input
              value={newColumnName ?? ''}
              oninput={(event) => drafts.set(columnKey, event.currentTarget.value)}
              use:focusIf={{
                active: columnFormOpenedHere,
                onfocused: () => (columnFormOpenedHere = false),
              }}
              aria-label="Column name"
              placeholder="Column name"
              autocapitalize="sentences"
              onkeydown={(event) => {
                if (event.key === 'Escape') {
                  closeNewColumn();
                }
              }}
              class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm outline-none focus:border-accent"
            />
            <div class="flex gap-2">
              <Button type="submit" class="flex-1">Add column</Button>
              <Button variant="ghost" onclick={closeNewColumn}>Cancel</Button>
            </div>
          </form>
        {:else}
          <button
            type="button"
            onclick={startNewColumn}
            class="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-edge px-3 text-sm font-medium text-muted hover:border-accent hover:text-ink"
          >
            + Add column
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>
