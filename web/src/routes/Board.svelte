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
  import { DROP_TARGET_STYLE, flipDuration } from '../lib/dnd';
  import { draftKey, drafts } from '../lib/drafts.svelte';
  import { edgeScrollSpeed, fitsHorizontally } from '../lib/board-scroll';
  import {
    columnElements,
    columnSnapAlign,
    restingSnapIndex,
    snapLeft,
    snapTargets,
  } from '../lib/board-snap';
  import {
    settleScrollLeft,
    SWIPE_AXIS_LOCK_PX,
    SWIPE_SETTLE_MS,
    swipeTarget,
    SWIPE_VELOCITY_SAMPLE_MS,
  } from '../lib/board-swipe';
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

  const cardClass = 'rounded-md focus-ring-flush';

  // Svelte's animate: directive measures EVERY item in the list with two
  // getBoundingClientRect() calls each time the list changes — and a drag
  // rewrites the list on every pointer move — so a long column pays a
  // whole-column forced layout per move. Measured at 2.00 rect reads per card
  // per move: 1600 of them on an 800-card column, half a second of blocked main
  // thread. Past this many cards the animation is dropped; a card that jumps to
  // its new place beats a board that stalls.
  const FLIP_MAX_CARDS = 80;

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

  // -1 unless the board is readonly, because otherwise the "+ Add column" tile is
  // the last snap target and no column ends the board. `columnSnapAlign` in
  // board-snap.ts is where the alignment that follows from this is decided.
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
  //
  // What that costs, which is not obvious and has cost a debugging session: the
  // library re-decides the drop zone on a poll, and skips the decision unless its
  // reference point moved ~10px OR *its own* scroller just scrolled. Hidden from
  // that scroller, the board scrolling is a move it cannot see. So a finger held
  // still in the edge band below, with columns sliding past underneath it, leaves
  // the placeholder wherever the last decision put it — and the drop commits
  // there, not under the finger. Reaching a column by parking at the edge is
  // therefore less reliable than reaching one by moving onto it; only the second
  // is what `useCursorForDetection` on the task zone below makes exact.
  const DRAG_EDGE_ZONE_PX = 80; // pointer within this band of an edge starts scrolling
  const DRAG_SCROLL_SPEED_PX_PER_S = 500; // top speed at the very edge; scales to 0 at the band's inner edge
  let boardScroller: HTMLElement | undefined = $state();
  // Column to center after a pointer drop. While set, snap stays off so the
  // centering slide isn't fought by scroll-snap.
  let centeringTarget = $state<string | null>(null);
  // Set by the edge scroller. A drag that moved the board left it wherever the
  // pointer stopped, which is almost never a snap position, so it has to land on
  // one deliberately even when the destination is already fully visible.
  let dragScrolled = false;
  const snapActive = $derived(!pointerDragging && centeringTarget === null);

  // --- The slide onto a column, and the snap suspension around it ---
  // Everything that moves the board deliberately goes through `settleOn`: the
  // swipe, the drop-centering, the quick-add reveal. Mandatory snap may only be
  // re-armed once the board is stationary and EXACTLY on the position, so the
  // moment the slide ends has to be a moment this component knows.
  let snapSuspended = false;
  // The target the running slide is heading for — the element, not its index: a
  // column arriving over the wire mid-slide renumbers the targets, and a swipe
  // interrupting the slide has to count from the same column either way.
  let settleTarget: HTMLElement | null = null;
  let settleFrame = 0;

  function suspendSnap(scroller: HTMLElement): void {
    scroller.style.scrollSnapType = 'none';
    snapSuspended = true;
  }

  function releaseSnap(scroller: HTMLElement): void {
    scroller.style.scrollSnapType = '';
    snapSuspended = false;
  }

  // Does this board snap AT THIS BREAKPOINT — not "is snapping switched on right
  // now". The suspension above is the board's own doing and is indistinguishable
  // from `lg:snap-none` through `getComputedStyle`, so reading the style alone made
  // every swipe that began while the previous one was still settling look like a
  // swipe on a desktop board, and be refused. Refused with snap off, which is the
  // worse half: whatever did move the board then moved it unconstrained by snap.
  function boardSnaps(scroller: HTMLElement): boolean {
    return snapSuspended || getComputedStyle(scroller).scrollSnapType !== 'none';
  }

  // Cancelling is not finishing: this drops the slide without re-arming snap,
  // which is what both callers want — a new gesture turns snap off again anyway,
  // and teardown releases it once on its way out.
  function cancelSettle(): void {
    cancelAnimationFrame(settleFrame);
    settleFrame = 0;
    settleTarget = null;
  }

  // The destination is measured once, not per frame. `animate:flip` transforms the
  // very columns that define the snap positions, and a rect read mid-flip reports
  // the transformed box — so a slide that re-aimed each frame would chase the flip
  // animation rather than the column's resting place.
  function settleOn(scroller: HTMLElement, target: HTMLElement, onDone?: () => void): void {
    cancelSettle();
    settleTarget = target;
    const from = scroller.scrollLeft;
    const to = snapLeft(scroller, target);
    const duration = motion.reduced ? 0 : SWIPE_SETTLE_MS;
    const started = performance.now();
    // `performance.now()` again rather than the frame timestamp the callback is
    // handed: the two share a clock in a browser and do not in jsdom, where the
    // frame time trails it by a few hundred ms. Subtracting one from the other
    // there makes the first frames land at a negative elapsed and the slide take
    // several times its duration — with the tests still passing, since they only
    // wait longer.
    const step = () => {
      const elapsed = performance.now() - started;
      scroller.scrollLeft = settleScrollLeft(from, to, elapsed, duration);
      if (elapsed < duration) {
        settleFrame = requestAnimationFrame(step);
        return;
      }
      settleFrame = 0;
      settleTarget = null;
      releaseSnap(scroller);
      onDone?.();
    };
    // Scheduled rather than run inline, so a zero-length slide under reduced motion
    // still finishes a frame later the way a real one does — a caller that sets
    // state in `onDone` behaves the same either way.
    settleFrame = requestAnimationFrame(step);
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
    if (!scroller || dragging) {
      return;
    }
    // Read and cleared as the drag ends, whether or not anything is being
    // centered: a drag that scrolled and then centered nothing — let go over no
    // zone, or unwound by the card menu — otherwise leaves the flag set, and the
    // next drop or quick-add reveal slides a board that should stay put.
    const scrolled = dragScrolled;
    dragScrolled = false;
    if (target === null) {
      return;
    }
    const column = columnElements(scroller).find((el) => el.dataset.columnId === target);
    if (
      column === undefined ||
      (!scrolled &&
        fitsHorizontally(scroller.getBoundingClientRect(), column.getBoundingClientRect()))
    ) {
      centeringTarget = null;
      return;
    }
    // Snap here is suspended by the `snapActive` class rather than by the inline
    // style, so the release inside the slide is a no-op and clearing
    // `centeringTarget` is what re-arms it — after the board is on the position,
    // which is the whole reason this waits for the slide to finish at all.
    settleOn(scroller, column, () => (centeringTarget = null));
    // Only this effect's own slide. Its dependencies include `dragging`, so an
    // unguarded cleanup would cancel a swipe's slide the moment a drag began and
    // leave snap suspended with nothing left to re-arm it.
    return () => {
      if (settleTarget === column) {
        cancelSettle();
      }
    };
  });

  // --- A touch swipe moves at most one column ---
  // The board owns the horizontal gesture on touch rather than letting the
  // browser scroll and correcting afterwards: the target it lands on is
  // `origin ± 1` by construction, which nothing about drag length or engine
  // momentum can widen.
  //
  // Correcting after the fact cannot do this. `scroll-snap-stop: always` governs
  // only the inertial phase, so a long drag crosses two columns with it honoured;
  // and a correction is by definition visible as the overshoot it undoes.
  //
  // Owning it means the browser must not be scrolling the same element too.
  // `touch-action: pan-y` asks for that, but it is a declaration, and a browser
  // that scrolls anyway carries the board past the column this gesture chose —
  // so every move the gesture has claimed is also `preventDefault`ed.
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
      // The slide this gesture interrupted, if it interrupted one. A gesture that
      // then comes to nothing hands it back rather than abandoning the board
      // part-way through it.
      carried: HTMLElement | null;
      horizontal: boolean;
      lastX: number;
      velX: number;
      velT: number;
      velocity: number;
    }
    let swipe: Swipe | null = null;
    // A card drag owns the same finger, and the open menu is anchored to it.
    // A *pending* press is not in that list on purpose: pointerdown precedes
    // touchstart, so every swipe that starts on a card — nearly all of them —
    // would be refused before it began. The press cancels itself once the finger
    // passes its own slop, which any real swipe does.
    const busy = () => dragging || cardMenu.taskId !== null;

    // Give the gesture back. The board must be left ON a snap position however
    // this happens: re-arming mandatory snap anywhere else is what resolves it
    // onto whichever column the browser likes, which is the jump this whole
    // arrangement exists to avoid.
    const abandon = () => {
      const gesture = swipe;
      swipe = null;
      const resume = gesture?.horizontal
        ? (snapTargets(scroller)[gesture.origin] ?? null)
        : (gesture?.carried ?? null);
      if (resume !== null) {
        settleOn(scroller, resume);
      } else if (settleTarget === null && snapSuspended) {
        releaseSnap(scroller);
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      // Nothing to take over where the board doesn't snap (lg and up), and a
      // second finger means a pinch, not a swipe. Both go through `abandon` so a
      // gesture refused mid-swipe cannot leave snap suspended behind it, which
      // then reads as "desktop" and refuses every swipe after it too.
      if (touch === undefined || event.touches.length !== 1 || busy() || !boardSnaps(scroller)) {
        abandon();
        return;
      }
      // A gesture that arrives mid-slide counts from the column the slide was
      // heading for, not from wherever the animation had reached. That is what
      // makes a second swipe advance exactly one more column instead of skipping
      // or repeating one — the board's committed position is the target, and the
      // live `scrollLeft` below only decides what follows the finger.
      const targets = snapTargets(scroller);
      const carried = settleTarget;
      const carriedIndex = carried === null ? -1 : targets.indexOf(carried);
      cancelSettle();
      swipe = {
        startX: touch.clientX,
        startY: touch.clientY,
        startLeft: scroller.scrollLeft,
        origin: carriedIndex === -1 ? restingSnapIndex(scroller) : carriedIndex,
        lastIndex: targets.length - 1,
        carried,
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
        abandon();
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
          abandon();
          return;
        }
        swipe.horizontal = true;
        suspendSnap(scroller);
      }
      // Claimed. Everything below this line is the board scrolling itself, and a
      // browser scrolling it in parallel is the one thing that can carry it past
      // `origin ± 1`. Vertical gestures return above and are never touched.
      event.preventDefault();
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
      // A tap, or a gesture the axis lock never resolved. It may still have
      // interrupted a slide, which `abandon` resumes.
      if (gesture === null || !gesture.horizontal) {
        abandon();
        return;
      }
      swipe = null;
      const destination =
        snapTargets(scroller)[
          swipeTarget(
            gesture.origin,
            gesture.lastX - gesture.startX,
            gesture.velocity,
            gesture.lastIndex
          )
        ];
      if (destination === undefined) {
        releaseSnap(scroller);
        return;
      }
      // Snap stays off until the slide lands exactly on the target, so re-arming
      // it is the no-op it should be rather than a second, visible correction.
      settleOn(scroller, destination);
    };

    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    // The one non-passive listener here, and it has to be: `preventDefault` above
    // is what stops the browser scrolling the board alongside the gesture.
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd, { passive: true });
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
      // A slide that outlives the component runs against a window that is no
      // longer there — a stray style write in a browser, and an unhandled
      // ReferenceError under a runner tearing jsdom down around it.
      cancelSettle();
      releaseSnap(scroller);
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
      const unmoved = origin === items.findIndex((column) => column.id === event.detail.info.id);
      const drop = unmoved ? null : placementAfterDrop(items, event.detail.info.id);
      // Landed on a snap position for the same reason the card path is.
      if (event.detail.info.source === SOURCES.POINTER && (drop !== null || dragScrolled)) {
        centeringTarget = event.detail.info.id;
      }
      if (drop !== null) {
        void board.moveColumn(event.detail.info.id, drop.placement, drop.intent);
      }
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
      // renumber it and log it for nothing.
      const unmoved =
        origin?.columnId === columnId &&
        origin.index === items.findIndex((task) => task.id === event.detail.info.id);
      const drop = unmoved ? null : placementAfterDrop(items, event.detail.info.id);
      // A drag that scrolled parked the board off every snap position, so it is
      // landed on one even when nothing moved — but only then, because a long
      // press opening the card menu unwinds its drag through here and must not
      // slide the board under the menu it just anchored to the finger. The edge
      // scroller refuses to run for a pending or open press, so that unwind
      // arrives here with `dragScrolled` false.
      if (event.detail.info.source === SOURCES.POINTER && (drop !== null || dragScrolled)) {
        centeringTarget = columnId;
      }
      if (drop !== null) {
        void board.moveTask(event.detail.info.id, columnId, drop.placement, drop.intent);
      }
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
        flipDurationMs: flipDuration(),
        dropAnimationDisabled: motion.reduced,
        dropTargetStyle: DROP_TARGET_STYLE,
        delayTouchStart: true,
        dragDisabled: readonly,
        dropFromOthersDisabled: readonly,
      }}
      onconsider={handleColumnConsider}
      onfinalize={handleColumnFinalize}
    >
      {#each localColumns as column, index (column.id)}
        <div
          data-column-id={column.id}
          data-snap-target
          animate:flip={{ duration: flipDuration() }}
          aria-label={column.name}
          class="flex w-[var(--cp-board-col-w)] shrink-0 snap-always flex-col md:snap-start {columnSnapAlign(
            index,
            endColumnIndex
          )}"
        >
          <!-- The column proper: it draws the surface, and it ends where its cards
               do, so "+ Add task" sits under the last one rather than at the foot of
               the screen. The full-height wrapper above draws nothing and keeps the
               geometry the board reads off it — the snap position, the flip, and the
               box a dragged column is measured by — the same whatever a column holds.

               Held to the wrapper's height by flex-shrink rather than by max-h-full,
               because a percentage height needs the parent's to resolve and that is
               what stops happening on the mobile engines this board is checked
               against — where a column outgrowing the board is what pushes the bottom
               nav off the screen. `min-h-0` is what lets the shrink happen at all: a
               flex item's automatic minimum is its content's height, and a scrolling
               child does not lower it, so the panel's own minimum is the whole card
               stack and it would overflow rather than cap. The list keeps `min-h-16`
               as its floor, and the header and composer are `shrink-0`, so the cards
               are what gives up the room. -->
          <div
            data-column-panel
            class="flex min-h-0 flex-col rounded-lg border border-edge bg-surface"
          >
            <ColumnHeader
              {column}
              {readonly}
              count={board.tasksInColumn(column.id).length}
              matchCount={board.hasActiveFilters ? board.matchingCountInColumn(column.id) : null}
            />
            <div
              class="flex min-h-16 flex-col gap-2 overflow-y-auto p-2"
              data-task-list={column.id}
              aria-label="{column.name} tasks"
              use:scrollToTopOn={board.filterSignature}
              use:dndzone={{
                items: localTasks.get(column.id) ?? [],
                type: 'task',
                flipDurationMs: animatedColumns.has(column.id) ? flipDuration() : 0,
                dropAnimationDisabled: motion.reduced,
                dropTargetStyle: DROP_TARGET_STYLE,
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
                    animate:flip={{ duration: flipDuration() }}
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
              <div data-quick-add={column.id} class="shrink-0">
                <QuickAddTask columnId={column.id} />
              </div>
            {/if}
          </div>
        </div>
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
              class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm focus-ring focus:border-accent"
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
