<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
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
  import { board, placementAfterDrop } from '../lib/board.svelte';
  import type { BoardColumn, BoardLabel, BoardTask } from '../lib/board-types';
  import { cardMenu, TOUCH_DRAG_DELAY_MS } from '../lib/card-menu.svelte';
  import { draftKey, drafts } from '../lib/drafts.svelte';
  import {
    edgeScrollSpeed,
    fitsHorizontally,
    nearestSnapIndex,
    type SnapAlign,
    snapScrollLeft,
  } from '../lib/board-scroll';
  import { SWIPE_AXIS_LOCK_PX, swipeTarget, SWIPE_VELOCITY_SAMPLE_MS } from '../lib/board-swipe';
  import { motion } from '../lib/motion.svelte';
  import { shortcuts } from '../lib/shortcuts.svelte';
  import { truncateTitle } from '../lib/titles';
  import CardMenu from '../components/CardMenu.svelte';
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
  const dropTargetStyle = { outline: '2px solid var(--cp-accent)', outlineOffset: '-2px' };
  const cardClass = 'rounded-md focus-visible:outline-2 focus-visible:outline-accent';

  // Svelte's animate: directive measures EVERY item in the list with two
  // getBoundingClientRect() calls each time the list changes — and a drag
  // rewrites the list on every pointer move — so a long column pays a
  // whole-column forced layout per move. Measured at 2.00 rect reads per card
  // per move: 1600 of them on an 800-card column, half a second of blocked main
  // thread. Past this many cards the animation is dropped; a card that jumps to
  // its new place beats a board that stalls.
  const FLIP_MAX_CARDS = 80;

  const flipMs = $derived(motion.reduced ? 0 : FLIP_MS);

  function tasksByColumn(): Record<string, BoardTask[]> {
    const next: Record<string, BoardTask[]> = {};
    for (const column of board.columns) {
      next[column.id] = board.displayTasksInColumn(column.id);
    }
    return next;
  }

  // A zero flipDurationMs does NOT avoid the cost: the measure/apply pass runs
  // whatever the duration, which is why reduced motion is answered by dropping
  // the directive here rather than by shortening it.
  function animatableColumns(): ReadonlySet<string> {
    if (motion.reduced) {
      return new Set();
    }
    return new Set(
      board.columns
        .filter((column) => board.tasksInColumn(column.id).length <= FLIP_MAX_CARDS)
        .map((column) => column.id)
    );
  }

  // Seeded from the store rather than left empty for the effects below to fill:
  // an effect runs after the first render, and a board that renders no columns at
  // all — even once — leaves the "+ Add column" tile as the only scroll-snap
  // target in the scroller. The browser snaps to it, and inserting the columns in
  // front of it a moment later strands the board at the far right end.
  //
  // Raw, not deep state: this is handed to svelte-dnd-action as an action
  // argument, and Svelte deep-reads an action's argument through the $state proxy
  // to track it — walking every field of every item on every re-render. Nothing
  // mutates it in place, so the reactivity a proxy buys is unused.
  let localColumns = $state.raw<BoardColumn[]>([...board.columns]);
  // One instance mutated in place, and a map rather than a record: SvelteMap
  // gives every column its own signal, so rewriting the dragged column's list on
  // each pointer move re-runs only that column's cards. Behind one signal — a
  // plain $state record — every column re-rendered on every move, and each one
  // paid the animate: measure pass over all of its cards. Its values are handed
  // out as-is, so they stay off the $state proxy like localColumns above.
  const localTasks = new SvelteMap<string, BoardTask[]>();

  function syncLocalTasks(): void {
    const next = tasksByColumn();
    // Untracked: adding or removing a key bumps the map's version signal, which
    // the caller's effect would otherwise pick up and re-enter on.
    untrack(() => {
      for (const columnId of [...localTasks.keys()]) {
        if (!(columnId in next)) {
          localTasks.delete(columnId);
        }
      }
      for (const [columnId, tasks] of Object.entries(next)) {
        localTasks.set(columnId, tasks);
      }
    });
  }

  syncLocalTasks();

  let columnDragging = $state(false);
  let taskDragging = $state(false);
  // svelte-dnd-action drives a keyboard drag by focusing the moved element after
  // every arrow press, so the board already follows it. Dropping snap for one
  // only means re-arming it afterwards wherever that focus left the scroll, which
  // a mandatory-snap container resolves with a jump to a neighboring column.
  let keyboardDragging = $state(false);
  let dragOrigin: { columnId: string; index: number } | null = null;
  let columnDragOrigin: number | null = null;

  // Where each column parks on a phone. The ends align to the board's edges and
  // everything between centers, so being flush against an edge means you are at
  // that end of the board and nothing else does. Centering the ends instead is
  // what used to cost half a viewport of blank canvas in front of the first
  // column and behind the last. From md up they all start-align, as before.
  //
  // The board's last snap target is the "+ Add column" tile, so a column only ends
  // the board when that tile is not rendered. A lone column on a readonly board
  // matches both arms; start wins, which is right — such a board does not scroll.
  //
  // Mixing alignments makes the swipe pitch uneven at the ends. That is a cost of
  // this arrangement rather than an oversight in it, and it is bigger than it
  // looks from a portrait phone. Measured in Chrome, the gaps between consecutive
  // snap positions are 261, 300 x6, 261 at 390px — 13%, invisible — but 86,
  // 300 x6, 86 at 740px, where two columns already fit and the first swipe
  // therefore travels a third as far as every swipe after it. Uniform
  // start-alignment would flatten it to 300 everywhere; the centered middle is
  // what it would cost.
  const endColumnIndex = $derived(readonly ? localColumns.length - 1 : -1);
  function columnSnapAlign(index: number): string {
    if (index === 0) {
      return 'snap-start';
    }
    return index === endColumnIndex ? 'snap-end' : 'snap-center';
  }

  const columnKey = $derived(draftKey.addColumn(projectId));
  const newColumnName = $derived(drafts.get(columnKey));
  const addingColumn = $derived(newColumnName !== null);
  let columnFormOpenedHere = $state(false);

  const dragging = $derived(columnDragging || taskDragging);
  const pointerDragging = $derived(dragging && !keyboardDragging);

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
  const SWIPE_SETTLE_TIMEOUT_MS = 500; // same, for the slide that ends a swipe
  let boardScroller: HTMLElement | undefined = $state();
  // Column to center after a pointer drop. While set, snap stays off so the
  // centering slide isn't fought by scroll-snap.
  let centeringTarget = $state<string | null>(null);
  // Set by the edge scroller. A drag that moved the board left it wherever the
  // pointer stopped, which is almost never a snap position, so it has to land on
  // one deliberately even when the destination is already fully visible.
  let dragScrolled = false;
  const snapActive = $derived(!pointerDragging && centeringTarget === null);

  function columnSections(scroller: HTMLElement): HTMLElement[] {
    return Array.from(scroller.querySelectorAll<HTMLElement>('section'));
  }

  // Every snap target, not just the columns: the "+ Add column" tile is one too,
  // so leaving it out puts the index off by one whenever it is involved.
  function snapTargets(scroller: HTMLElement): HTMLElement[] {
    return Array.from(scroller.querySelectorAll<HTMLElement>('[data-snap-target]'));
  }

  // The `scrollLeft` that parks one snap target, alignment and all.
  //
  // Reading the alignment and scroll padding back off the elements keeps the
  // breakpoints that set them in one place — the class list — rather than
  // duplicating rem values and a `md` cutoff here. That matters more now that the
  // three targets of a phone board do not agree: the first column starts, the last
  // one ends, the rest center. `scroll-snap-align` serializes as `<block>
  // <inline>`, so the last token is the axis this scroller uses; a stylesheet-less
  // environment reports neither, which reads as start.
  function snapLeft(scroller: HTMLElement, target: HTMLElement): number {
    const inline = getComputedStyle(target).scrollSnapAlign.split(' ').pop();
    const align: SnapAlign = inline === 'center' || inline === 'end' ? inline : 'start';
    const style = getComputedStyle(scroller);
    return snapScrollLeft(
      scroller.scrollLeft,
      scroller.getBoundingClientRect(),
      target.getBoundingClientRect(),
      align,
      {
        left: parseFloat(style.scrollPaddingLeft) || 0,
        right: parseFloat(style.scrollPaddingRight) || 0,
      }
    );
  }

  // Which target the board is resting on — the swipe's origin. Compared as scroll
  // positions rather than as distances from the middle of the screen, because with
  // the ends aligned to the edges the resting target is not the middle one.
  function restingSnapIndex(scroller: HTMLElement): number {
    return nearestSnapIndex(
      scroller.scrollLeft,
      snapTargets(scroller).map((target) => snapLeft(scroller, target))
    );
  }

  function slideColumnIntoView(scroller: HTMLElement, section: HTMLElement): void {
    scroller.scrollTo({
      left: snapLeft(scroller, section),
      behavior: motion.reduced ? 'auto' : 'smooth',
    });
  }

  // Slow, continuous edge scroll while dragging. Pointer drags only: a keyboard
  // drag leaves snap on, and a stray mouse move during one would then run the
  // per-frame scrollBy below against a snapping container — a fling per tick.
  $effect(() => {
    const scroller = boardScroller;
    if (!scroller || !pointerDragging) {
      return;
    }
    // A long press arms this drag before it opens the card menu, and the menu is
    // anchored to the finger: a press held near a column edge must not drift the
    // board while it waits, nor once the menu is sitting on top of it.
    if (cardMenu.pressPending || cardMenu.taskId !== null) {
      return;
    }
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
          dragScrolled = true;
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
  // A column the user can already see whole is left exactly where it is: moving a
  // card must not move the board out from under them. That makes this a no-op on
  // any screen wide enough to show the destination, and on a reorder within the
  // column they are already looking at — unless the drag scrolled, in which case
  // the board is parked off-snap and re-arming there would jump.
  //
  // The decision is made here rather than in the drop handlers because this runs
  // after Svelte has committed the DOM: a column reorder moves the very column
  // being measured, and a handler would measure it at its old position.
  $effect(() => {
    const scroller = boardScroller;
    const target = centeringTarget;
    if (!scroller || dragging || target === null) {
      return;
    }
    const section = columnSections(scroller).find((el) => el.dataset.columnId === target);
    const scrolled = dragScrolled;
    dragScrolled = false;
    if (
      section === undefined ||
      (!scrolled &&
        fitsHorizontally(scroller.getBoundingClientRect(), section.getBoundingClientRect()))
    ) {
      centeringTarget = null;
      return;
    }
    slideColumnIntoView(scroller, section);
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

  // --- A touch swipe moves at most one column ---
  // The board owns the horizontal gesture on touch rather than letting the
  // browser scroll and correcting afterwards. `touch-action: pan-y` below lg
  // means no native horizontal pan and no momentum, so the only thing that moves
  // the board sideways is the drag below — and the target it lands on is
  // `origin ± 1` by construction, which nothing about drag length or engine
  // momentum can widen.
  //
  // Correcting after the fact cannot do this. `scroll-snap-stop: always` governs
  // only the inertial phase, so a long drag crosses two columns with it honoured;
  // and a correction is by definition visible as the overshoot it undoes.
  //
  // Snap is suspended inline, not through `snapActive`: a class change lands a
  // microtask later, and mandatory snap re-snaps every scrollLeft written before
  // it does, so the first frames of the drag would not follow the finger.
  $effect(() => {
    const scroller = boardScroller;
    if (!scroller) {
      return;
    }
    interface Swipe {
      startX: number;
      startY: number;
      startLeft: number;
      origin: number;
      lastIndex: number;
      horizontal: boolean;
      lastX: number;
      velX: number;
      velT: number;
      velocity: number;
    }
    let swipe: Swipe | null = null;
    const releaseSnap = () => {
      scroller.style.scrollSnapType = '';
    };
    // A card drag owns the same finger, and the open menu is anchored to it.
    // A *pending* press is not in that list on purpose: pointerdown precedes
    // touchstart, so every swipe that starts on a card — nearly all of them —
    // would be refused before it began. The press cancels itself once the finger
    // passes its own slop, which any real swipe does.
    const busy = () => dragging || cardMenu.taskId !== null;

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      // Nothing to take over where the board doesn't snap (lg and up), and a
      // second finger means a pinch, not a swipe.
      if (
        touch === undefined ||
        event.touches.length !== 1 ||
        busy() ||
        getComputedStyle(scroller).scrollSnapType === 'none'
      ) {
        swipe = null;
        return;
      }
      swipe = {
        startX: touch.clientX,
        startY: touch.clientY,
        startLeft: scroller.scrollLeft,
        origin: restingSnapIndex(scroller),
        lastIndex: snapTargets(scroller).length - 1,
        horizontal: false,
        lastX: touch.clientX,
        velX: touch.clientX,
        velT: performance.now(),
        velocity: 0,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (swipe === null || touch === undefined) {
        return;
      }
      if (busy()) {
        swipe = null;
        releaseSnap();
        return;
      }
      const dx = touch.clientX - swipe.startX;
      const dy = touch.clientY - swipe.startY;
      if (!swipe.horizontal) {
        if (Math.abs(dx) < SWIPE_AXIS_LOCK_PX && Math.abs(dy) < SWIPE_AXIS_LOCK_PX) {
          return;
        }
        // A vertical gesture belongs to the column's card list; hand it back for
        // the rest of this touch rather than re-judging it every move.
        if (Math.abs(dy) >= Math.abs(dx)) {
          swipe = null;
          return;
        }
        swipe.horizontal = true;
        scroller.style.scrollSnapType = 'none';
      }
      swipe.lastX = touch.clientX;
      const now = performance.now();
      const sample = now - swipe.velT;
      if (sample >= SWIPE_VELOCITY_SAMPLE_MS) {
        swipe.velocity = ((touch.clientX - swipe.velX) / sample) * 1000;
        swipe.velX = touch.clientX;
        swipe.velT = now;
      }
      scroller.scrollLeft = swipe.startLeft - dx;
    };

    const onTouchEnd = () => {
      const gesture = swipe;
      swipe = null;
      if (gesture === null || !gesture.horizontal) {
        return;
      }
      const section =
        snapTargets(scroller)[
          swipeTarget(
            gesture.origin,
            gesture.lastX - gesture.startX,
            gesture.velocity,
            gesture.lastIndex
          )
        ];
      if (section === undefined) {
        releaseSnap();
        return;
      }
      // Snap stays off until the slide settles on the target, so re-arming it is
      // the no-op it should be rather than a second, visible correction.
      slideColumnIntoView(scroller, section);
      let done = false;
      const finish = () => {
        if (done) {
          return;
        }
        done = true;
        window.clearTimeout(timeout);
        scroller.removeEventListener('scrollend', finish);
        releaseSnap();
      };
      const timeout = window.setTimeout(finish, SWIPE_SETTLE_TIMEOUT_MS);
      scroller.addEventListener('scrollend', finish);
    };

    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: true });
    scroller.addEventListener('touchend', onTouchEnd, { passive: true });
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
      releaseSnap();
    };
  });

  // QuickAddTask encapsulates its open/focus state, so the shortcut opens it via its trigger.
  $effect(() => {
    const columnId = shortcuts.quickAddColumn;
    if (columnId === null) {
      return;
    }
    untrack(() => {
      shortcuts.quickAddColumn = null;
      // The shortcut can name a column nowhere near the viewport, so something has
      // to reveal it — but not focus(), which scrolls to wherever the input sits
      // and leaves a mandatory-snap board between two snap points, free to resolve
      // onto a neighbor. This is the slide a pointer drop uses: it lands on the
      // snap position and is a no-op for a column already fully visible.
      centeringTarget = columnId;
      const host = document.querySelector(`[data-quick-add="${CSS.escape(columnId)}"]`);
      const input = host?.querySelector('input');
      if (input instanceof HTMLInputElement) {
        input.focus({ preventScroll: true });
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
      syncLocalTasks();
    }
  });

  // Frozen for the length of a drag. Swapping a column between the animated and
  // plain branch rebuilds every card in it, which mid-gesture would tear the DOM
  // out from under svelte-dnd-action — it tracks the drag by element identity.
  // Seeded like localColumns above so the first paint is already the right
  // branch rather than a rebuild one frame later.
  let animatedColumns = $state.raw<ReadonlySet<string>>(animatableColumns());

  $effect(() => {
    if (!dragging) {
      animatedColumns = animatableColumns();
    }
  });

  const labelById = $derived(new Map(board.labels.map((label) => [label.id, label])));
  const taskById = $derived(new Map(board.tasks.map((task) => [task.id, task])));
  const doneColumnIds = $derived(board.doneColumnIds);

  function labelsFor(task: BoardTask): BoardLabel[] {
    return task.label_ids.flatMap((id) => labelById.get(id) ?? []);
  }

  // blocker_ids is same-project by contract, so every id in it resolves against
  // this board. Blockers on other boards are never named here; the server sends
  // their open count already resolved, because the board read deliberately does
  // not join across the project boundary to find out.
  function openBlockerCount(task: BoardTask): number {
    const local = task.blocker_ids.filter((id) => {
      const blocker = taskById.get(id);
      return blocker !== undefined && !doneColumnIds.has(blocker.column_id);
    }).length;
    return local + task.open_cross_project_blocker_count;
  }

  // Keyboard drags end with a consider event (trigger DRAG_STOPPED), not a
  // finalize, so the dragging flags must reset here too.
  function handleColumnConsider(event: CustomEvent<DndEvent<BoardColumn>>): void {
    if (event.detail.info.trigger === TRIGGERS.DRAG_STARTED) {
      keyboardDragging = event.detail.info.source === SOURCES.KEYBOARD;
      centeringTarget = null; // a new drag cancels any pending drop-center
      columnDragOrigin = localColumns.findIndex((column) => column.id === event.detail.info.id);
    }
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
      const origin = columnDragOrigin;
      columnDragOrigin = null;
      // Same as a card put back where it was, except a wasted column write also
      // fans a realtime update out to everyone else looking at the project.
      if (origin === items.findIndex((column) => column.id === event.detail.info.id)) {
        return;
      }
      if (event.detail.info.source === SOURCES.POINTER) {
        centeringTarget = event.detail.info.id;
      }
      void board.moveColumn(event.detail.info.id, placementAfterDrop(items, event.detail.info.id));
    }
  }

  function handleTaskConsider(columnId: string, event: CustomEvent<DndEvent<BoardTask>>): void {
    if (event.detail.info.trigger === TRIGGERS.DRAG_STARTED) {
      keyboardDragging = event.detail.info.source === SOURCES.KEYBOARD;
      centeringTarget = null; // a new drag cancels any pending drop-center
      dragOrigin = {
        columnId,
        index: (localTasks.get(columnId) ?? []).findIndex(
          (task) => task.id === event.detail.info.id
        ),
      };
    }
    taskDragging = event.detail.info.trigger !== TRIGGERS.DRAG_STOPPED;
    localTasks.set(columnId, event.detail.items);
  }

  function handleTaskFinalize(columnId: string, event: CustomEvent<DndEvent<BoardTask>>): void {
    const items = event.detail.items.filter((task) => task.id !== SHADOW_PLACEHOLDER_ITEM_ID);
    localTasks.set(columnId, items);
    // The origin zone's finalize (DROPPED_INTO_ANOTHER) must not end the drag: the
    // target zone's DROPPED_INTO_ZONE is the single place that commits the move.
    // Keyboard finalizes fire per arrow press, so they keep the flag up too.
    if (event.detail.info.trigger !== TRIGGERS.DROPPED_INTO_ANOTHER) {
      taskDragging = event.detail.info.source === SOURCES.KEYBOARD;
    }
    if (event.detail.info.trigger === TRIGGERS.DROPPED_INTO_ZONE) {
      const origin = dragOrigin;
      dragOrigin = null;
      // A card put back exactly where it was is not a move: writing one would
      // renumber it and log it for nothing, and a long press opening the card menu
      // has to unwind its drag through this path — which must not then slide the
      // board under the menu it just anchored to the finger.
      if (
        origin?.columnId === columnId &&
        origin.index === items.findIndex((task) => task.id === event.detail.info.id)
      ) {
        return;
      }
      if (event.detail.info.source === SOURCES.POINTER) {
        centeringTarget = columnId;
      }
      void board.moveTask(
        event.detail.info.id,
        columnId,
        placementAfterDrop(items, event.detail.info.id)
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

{#snippet card(task: BoardTask)}
  <TaskCard
    {task}
    {projectId}
    {readonly}
    labels={labelsFor(task)}
    blockedCount={openBlockerCount(task)}
    done={doneColumnIds.has(task.column_id)}
    dimmed={board.hasActiveFilters && !board.taskMatchesFilters(task)}
    changed={board.changedTaskIds.has(task.id)}
  />
{/snippet}

<div
  bind:this={boardScroller}
  class="relative flex min-h-0 touch-pan-y touch-pinch-zoom flex-1 flex-col overscroll-x-contain overflow-y-hidden scroll-p-3 lg:touch-auto lg:scroll-p-4 {snapActive
    ? 'overflow-x-auto snap-x snap-mandatory lg:snap-none'
    : 'overflow-x-hidden'}"
>
  <!-- w-max, not the default stretch-to-scroller width: a stretched track ends at
       the scroller's right edge, so its padding-right lands there rather than after
       the last column, and the last column butts against the screen with no gutter
       while the leading one keeps its. Sizing the track to its content is what puts
       the same gutter on both ends of the row. -->
  <div class="flex w-max min-h-0 flex-1 items-stretch gap-3 px-3 py-3 lg:gap-4 lg:px-4 lg:py-4">
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
      {#each localColumns as column, index (column.id)}
        <section
          data-column-id={column.id}
          data-snap-target
          animate:flip={{ duration: flipMs }}
          aria-label={column.name}
          class="flex max-h-full w-[var(--cp-board-col-w)] shrink-0 snap-always flex-col rounded-lg border border-edge bg-surface md:snap-start {columnSnapAlign(
            index
          )}"
        >
          <ColumnHeader
            {column}
            {readonly}
            count={board.tasksInColumn(column.id).length}
            matchCount={board.hasActiveFilters ? board.matchingCountInColumn(column.id) : null}
          />
          <div
            class="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2"
            data-task-list={column.id}
            aria-label="{column.name} tasks"
            use:scrollToTopOn={board.filterSignature}
            use:dndzone={{
              items: localTasks.get(column.id) ?? [],
              type: 'task',
              flipDurationMs: animatedColumns.has(column.id) ? flipMs : 0,
              dropAnimationDisabled: motion.reduced,
              dropTargetStyle,
              delayTouchStart: TOUCH_DRAG_DELAY_MS,
              // The finger picks the column, not the center of the card under it.
              // A card is nearly as wide as its column, so grabbing one anywhere
              // but the middle leaves its center up to half a column from the
              // finger — far enough on a phone to have the finger well inside the
              // next column while the center, which is what decides by default,
              // is still inside this one. That drop bounces back.
              useCursorForDetection: true,
              zoneItemTabIndex: readonly ? -1 : 0,
              dragDisabled: readonly,
              dropFromOthersDisabled: readonly,
            }}
            onconsider={(event) => handleTaskConsider(column.id, event)}
            onfinalize={(event) => handleTaskFinalize(column.id, event)}
          >
            {#if animatedColumns.has(column.id)}
              {#each localTasks.get(column.id) ?? [] as task (task.id)}
                <div
                  animate:flip={{ duration: flipMs }}
                  data-task-id={task.id}
                  aria-label={truncateTitle(task.title)}
                  class={cardClass}
                >
                  {@render card(task)}
                </div>
              {/each}
            {:else}
              {#each localTasks.get(column.id) ?? [] as task (task.id)}
                <div
                  data-task-id={task.id}
                  aria-label={truncateTitle(task.title)}
                  class={cardClass}
                >
                  {@render card(task)}
                </div>
              {/each}
            {/if}
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
      <!-- The board's last snap target, so it is the one that ends it: flush against
           the right edge, with no trailing canvas to center into. -->
      <div
        data-snap-target
        class="w-[var(--cp-board-col-w)] shrink-0 snap-end snap-always md:snap-start"
      >
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

{#if cardMenu.taskId !== null}
  <CardMenu {projectId} canEdit={!readonly && board.canEdit} />
{/if}
