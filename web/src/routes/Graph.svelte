<script lang="ts">
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { board } from '../lib/board.svelte';
  import type { BoardTask } from '../lib/board-types';
  import { link } from '../lib/router.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import LabelFilterChips from '../components/LabelFilterChips.svelte';
  import {
    NODE_HEIGHT,
    NODE_WIDTH,
    computeGraph,
    edgePath,
    panToNode,
    type GraphResult,
    type LayoutEdge,
    type LayoutPoint,
    type ViewBox,
  } from '../lib/graph';

  interface Props {
    projectId: string;
  }

  let { projectId }: Props = $props();

  const MIN_VB_WIDTH = 160;
  const FIT_PADDING = 32;
  const FIT_MIN_WIDTH = 640;

  const result: GraphResult = $derived(computeGraph(board.tasks, board.columns));
  const layout = $derived(result.kind === 'ok' ? result.layout : null);
  const taskById = $derived(new Map<string, BoardTask>(board.tasks.map((t) => [t.id, t])));

  function nodeDimmed(id: string): boolean {
    if (!board.hasActiveFilters) return false;
    const task = taskById.get(id);
    return task !== undefined && !board.taskMatchesFilters(task);
  }

  function nodeLabelMatch(id: string): boolean {
    if (board.filterLabelIds.length === 0) return false;
    const task = taskById.get(id);
    return task !== undefined && board.taskMatchesFilters(task);
  }

  let cycleToastedFor: string | null = null;
  $effect(() => {
    if (result.kind === 'cycle') {
      if (cycleToastedFor !== projectId) {
        cycleToastedFor = projectId;
        toasts.error('Dependency cycle detected — the graph cannot be drawn.');
      }
    } else if (cycleToastedFor === projectId) {
      // Re-arm so a genuine cycle that appears later still toasts.
      cycleToastedFor = null;
    }
  });

  let svgEl = $state<SVGSVGElement | null>(null);
  let vb = $state<ViewBox>({ x: 0, y: 0, w: 1200, h: 800 });
  let panning = $state(false);

  let fittedFor: string | null = null;
  $effect(() => {
    const current = layout;
    if (!current || current.nodes.length === 0 || fittedFor === projectId) return;
    fittedFor = projectId;
    let x = -FIT_PADDING;
    let w = current.width + FIT_PADDING * 2;
    if (w < FIT_MIN_WIDTH) {
      x -= (FIT_MIN_WIDTH - w) / 2;
      w = FIT_MIN_WIDTH;
    }
    vb = { x, y: -FIT_PADDING, w, h: current.height + FIT_PADDING * 2 };
  });

  const pointers = new SvelteMap<number, { x: number; y: number }>();
  let panOrigin: { vb: ViewBox; x: number; y: number } | null = null;
  let pinchOrigin: { vb: ViewBox; dist: number; midX: number; midY: number } | null = null;
  let didDrag = false;
  let listenersAttached = false;

  let connectSource = $state<string | null>(null);
  let connectTarget = $state<string | null>(null);
  let connectPoint = $state<LayoutPoint | null>(null);
  let connectDirection = $state<'front' | 'back'>('front');
  let connectPointerId: number | null = null;
  let selectedEdgeId = $state<string | null>(null);
  let coarsePointer = $state(false);

  const connectSourceNode = $derived(
    connectSource === null ? null : (layout?.nodes.find((n) => n.id === connectSource) ?? null)
  );
  const connectOriginX = $derived(
    connectSourceNode === null
      ? 0
      : connectSourceNode.x + (connectDirection === 'back' ? -NODE_WIDTH / 2 : NODE_WIDTH / 2)
  );

  // A transient accent ring shows where the source/target (or a freshly created
  // node) landed after dagre re-lays-out; a single timer clears the whole set.
  const HIGHLIGHT_MS = 1800;
  const highlightedNodeIds = new SvelteSet<string>();
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;

  function highlightNodes(ids: readonly string[]): void {
    for (const id of ids) {
      highlightedNodeIds.add(id);
    }
    if (highlightTimer !== null) {
      clearTimeout(highlightTimer);
    }
    highlightTimer = setTimeout(() => {
      highlightedNodeIds.clear();
      highlightTimer = null;
    }, HIGHLIGHT_MS);
  }

  $effect(() => {
    return () => {
      if (highlightTimer !== null) clearTimeout(highlightTimer);
    };
  });

  let newTaskOpen = $state(false);
  let newTaskTitle = $state('');
  let newTaskInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (newTaskOpen) newTaskInput?.focus();
  });

  function openNewTask(): void {
    newTaskOpen = true;
  }

  function closeNewTask(): void {
    newTaskOpen = false;
    newTaskTitle = '';
  }

  function onNewTaskKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeNewTask();
    }
  }

  async function submitNewTask(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const title = newTaskTitle.trim();
    if (title === '') return;
    closeNewTask();
    const id = await board.createAndLinkTask(title);
    if (id === null) return;
    highlightNodes([id]);
    const node = layout?.nodes.find((n) => n.id === id);
    if (node !== undefined) {
      const panned = panToNode(vb, node);
      if (panned !== null) vb = panned;
    }
  }
  const selectedEdge = $derived(
    selectedEdgeId === null ? null : (layout?.edges.find((e) => e.id === selectedEdgeId) ?? null)
  );

  $effect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(hover: none)');
    coarsePointer = mq.matches;
    const update = (e: MediaQueryListEvent): void => {
      coarsePointer = e.matches;
    };
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  });

  $effect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      if (connectSource !== null) {
        cancelConnect();
      } else if (selectedEdgeId !== null) {
        selectedEdgeId = null;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function attachWindowListeners(): void {
    if (listenersAttached) return;
    listenersAttached = true;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
  }

  function detachWindowListeners(): void {
    if (!listenersAttached) return;
    listenersAttached = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerEnd);
    window.removeEventListener('pointercancel', onPointerEnd);
  }

  $effect(() => {
    return () => detachWindowListeners();
  });

  $effect(() => {
    const el = svgEl;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  function viewScale(v: ViewBox, rect: DOMRect): number {
    const scale = Math.min(rect.width / v.w, rect.height / v.h);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function svgPoint(
    v: ViewBox,
    rect: DOMRect,
    clientX: number,
    clientY: number
  ): { x: number; y: number } {
    const scale = viewScale(v, rect);
    const offsetX = (rect.width - v.w * scale) / 2;
    const offsetY = (rect.height - v.h * scale) / 2;
    return {
      x: v.x + (clientX - rect.left - offsetX) / scale,
      y: v.y + (clientY - rect.top - offsetY) / scale,
    };
  }

  function clampVbWidth(w: number): number {
    const max = Math.max((layout?.width ?? 0) * 4, 4000);
    return Math.min(Math.max(w, MIN_VB_WIDTH), max);
  }

  function zoomTo(width: number, anchorClientX: number, anchorClientY: number): void {
    const rect = svgEl?.getBoundingClientRect();
    if (!rect) return;
    const base = pinchOrigin?.vb ?? vb;
    const w = clampVbWidth(width);
    const h = base.h * (w / base.w);
    const anchorSource = pinchOrigin
      ? svgPoint(pinchOrigin.vb, rect, pinchOrigin.midX, pinchOrigin.midY)
      : svgPoint(vb, rect, anchorClientX, anchorClientY);
    const next: ViewBox = { x: 0, y: 0, w, h };
    const scale = viewScale(next, rect);
    const offsetX = (rect.width - w * scale) / 2;
    const offsetY = (rect.height - h * scale) / 2;
    next.x = anchorSource.x - (anchorClientX - rect.left - offsetX) / scale;
    next.y = anchorSource.y - (anchorClientY - rect.top - offsetY) / scale;
    vb = next;
  }

  function onPointerDown(e: PointerEvent): void {
    if (connectSource !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    selectedEdgeId = null;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    attachWindowListeners();
    didDrag = false;
    if (pointers.size === 1) {
      panOrigin = { vb: { ...vb }, x: e.clientX, y: e.clientY };
      pinchOrigin = null;
      panning = true;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      pinchOrigin = {
        vb: { ...vb },
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      };
      panOrigin = null;
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (connectSource !== null) {
      onConnectMove(e);
      return;
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = svgEl?.getBoundingClientRect();
    if (!rect) return;
    if (pinchOrigin && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist <= 0 || pinchOrigin.dist <= 0) return;
      didDrag = true;
      zoomTo(pinchOrigin.vb.w * (pinchOrigin.dist / dist), (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (panOrigin) {
      if (Math.abs(e.clientX - panOrigin.x) + Math.abs(e.clientY - panOrigin.y) > 3) {
        didDrag = true;
      }
      const scale = viewScale(panOrigin.vb, rect);
      vb = {
        ...panOrigin.vb,
        x: panOrigin.vb.x - (e.clientX - panOrigin.x) / scale,
        y: panOrigin.vb.y - (e.clientY - panOrigin.y) / scale,
      };
    }
  }

  function onPointerEnd(e: PointerEvent): void {
    if (connectSource !== null) {
      void onConnectEnd(e);
      return;
    }
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size === 1) {
      const [remaining] = [...pointers.values()];
      if (remaining) {
        panOrigin = { vb: { ...vb }, x: remaining.x, y: remaining.y };
      }
      pinchOrigin = null;
    } else if (pointers.size === 0) {
      panOrigin = null;
      pinchOrigin = null;
      panning = false;
      detachWindowListeners();
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (connectSource !== null) return;
    pinchOrigin = null;
    const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
    zoomTo(vb.w * factor, e.clientX, e.clientY);
  }

  // detail === 0 exempts keyboard-activated anchor clicks: didDrag stays set
  // until the next pointerdown, but Enter on a focused node must still navigate.
  function suppressClickAfterDrag(e: MouseEvent): void {
    if (didDrag && e.detail > 0) {
      e.preventDefault();
    }
  }

  function startConnect(e: PointerEvent, sourceId: string, direction: 'front' | 'back'): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    connectSource = sourceId;
    connectTarget = null;
    connectDirection = direction;
    connectPointerId = e.pointerId;
    selectedEdgeId = null;
    // The node anchor's capture-phase suppressor keys on didDrag, so the release
    // ending a connect never navigates even when it lands on a node.
    didDrag = true;
    const rect = svgEl?.getBoundingClientRect();
    connectPoint = rect ? svgPoint(vb, rect, e.clientX, e.clientY) : null;
    attachWindowListeners();
  }

  function onConnectMove(e: PointerEvent): void {
    if (e.pointerId !== connectPointerId) return;
    const rect = svgEl?.getBoundingClientRect();
    if (!rect) return;
    connectPoint = svgPoint(vb, rect, e.clientX, e.clientY);
    resolveConnectTarget(e);
  }

  // Touch/pen capture the pointer on the handle, suppressing pointerover on the
  // node under the finger, so the target is read from the point instead.
  function resolveConnectTarget(e: PointerEvent): void {
    const group = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node-id]');
    const id = group?.getAttribute('data-node-id') ?? null;
    connectTarget = id !== null && id !== connectSource ? id : null;
  }

  async function onConnectEnd(e: PointerEvent): Promise<void> {
    if (e.pointerId !== connectPointerId) return;
    resolveConnectTarget(e);
    const source = connectSource;
    const target = connectTarget;
    const direction = connectDirection;
    cancelConnect();
    if (source !== null && target !== null && target !== source) {
      // Front handle: source blocks target. Back handle: target blocks source.
      const added =
        direction === 'back'
          ? await board.addBlocker(source, target)
          : await board.addBlocker(target, source);
      // Only pulse the pair when the edge actually landed — not for a cycle
      // rejection or a duplicate no-op.
      if (added) highlightNodes([source, target]);
    }
  }

  function cancelConnect(): void {
    connectSource = null;
    connectTarget = null;
    connectPoint = null;
    connectPointerId = null;
    detachWindowListeners();
  }

  function onConnectOver(e: PointerEvent): void {
    if (connectSource === null) return;
    const group = (e.target as Element | null)?.closest('[data-node-id]');
    const id = group?.getAttribute('data-node-id') ?? null;
    connectTarget = id !== null && id !== connectSource ? id : null;
  }

  function selectEdge(event: MouseEvent, id: string): void {
    if (event.defaultPrevented) return;
    event.stopPropagation();
    selectedEdgeId = id;
  }

  function onEdgeKeydown(event: KeyboardEvent, id: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectedEdgeId = id;
    }
  }

  function deleteEdge(event: MouseEvent, edge: LayoutEdge): void {
    event.stopPropagation();
    void board.removeBlocker(edge.to, edge.from);
    selectedEdgeId = null;
  }

  function edgeMidpoint(points: readonly LayoutPoint[]): LayoutPoint {
    return points[Math.floor(points.length / 2)] ?? { x: 0, y: 0 };
  }
</script>

<div class="relative min-h-0 flex-1 overflow-hidden">
  {#if result.kind !== 'cycle'}
    <div
      class="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start gap-2 p-3"
    >
      <div class="pointer-events-auto flex items-center">
        {#if newTaskOpen}
          <form
            onsubmit={submitNewTask}
            class="flex items-center gap-1 rounded-md border border-edge bg-surface p-1 shadow-sm"
          >
            <input
              bind:this={newTaskInput}
              bind:value={newTaskTitle}
              onkeydown={onNewTaskKeydown}
              type="text"
              placeholder="Task title"
              aria-label="New task title"
              autocapitalize="sentences"
              class="h-9 w-44 rounded bg-canvas px-2 text-sm text-ink outline-none"
            />
            <button
              type="submit"
              class="flex min-h-11 cursor-pointer items-center rounded-md bg-accent px-3 text-sm font-medium text-white"
            >
              Add
            </button>
            <button
              type="button"
              onclick={closeNewTask}
              aria-label="Cancel new task"
              class="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-muted hover:text-ink"
            >
              ✕
            </button>
          </form>
        {:else}
          <button
            type="button"
            onclick={openNewTask}
            class="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-edge bg-surface px-3 text-sm font-medium text-ink shadow-sm hover:bg-accent-soft"
          >
            <svg
              class="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            New task
          </button>
        {/if}
      </div>
      {#if layout !== null && layout.nodes.length > 0 && (board.labels.length > 0 || board.hasActiveFilters)}
        <div
          class="pointer-events-auto flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 overflow-x-auto rounded-md border border-edge bg-surface/90 px-2 py-1 shadow-sm"
          role="group"
          aria-label="Label filters"
        >
          {#if board.labels.length > 0}
            <LabelFilterChips />
          {/if}
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
    </div>
  {/if}
  {#if result.kind === 'cycle'}
    <div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p class="text-base font-medium">Dependency cycle detected</p>
      <p class="max-w-sm text-sm text-muted">
        These tasks block each other in a loop, so the graph cannot be drawn. Remove one of the
        circular blockers to restore the view.
      </p>
    </div>
  {:else if layout === null || layout.nodes.length === 0}
    <div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p class="text-base font-medium">No tasks to graph</p>
      <p class="max-w-sm text-sm text-muted" use:link>
        Add tasks on the
        <a href="/projects/{projectId}" class="text-accent underline">board</a>, then link them with
        blockers to see the dependency graph.
      </p>
    </div>
  {:else}
    <svg
      bind:this={svgEl}
      role="application"
      aria-label="Dependency graph"
      viewBox="{vb.x} {vb.y} {vb.w} {vb.h}"
      preserveAspectRatio="xMidYMid meet"
      class="h-full w-full touch-none select-none {panning ? 'cursor-grabbing' : 'cursor-grab'}"
      onpointerdown={onPointerDown}
      onpointerover={onConnectOver}
      onclickcapture={suppressClickAfterDrag}
    >
      <defs>
        <marker
          id="cp-graph-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="9"
          markerHeight="9"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M 0 1 L 9 5 L 0 9 z" class="fill-muted" />
        </marker>
        <marker
          id="cp-graph-arrow-active"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="11"
          markerHeight="11"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M 0 1 L 9 5 L 0 9 z" class="fill-accent" />
        </marker>
      </defs>
      {#each layout.edges as e (e.id)}
        <path
          d={edgePath(e.points)}
          fill="none"
          class="stroke-muted {selectedEdgeId === e.id ? 'opacity-100' : 'opacity-50'}"
          stroke-width={selectedEdgeId === e.id ? 3.5 : 1.5}
          marker-end="url(#cp-graph-arrow)"
        />
      {/each}
      {#each layout.edges as e (e.id)}
        <path
          d={edgePath(e.points)}
          data-edge-id={e.id}
          fill="none"
          stroke="transparent"
          stroke-width="16"
          pointer-events="stroke"
          role="button"
          tabindex="0"
          aria-label="Dependency edge"
          class="cursor-pointer outline-none"
          onclick={(event) => selectEdge(event, e.id)}
          onkeydown={(event) => onEdgeKeydown(event, e.id)}
        />
      {/each}
      {#if connectSourceNode && connectPoint}
        {@const previewStart =
          connectDirection === 'back'
            ? connectPoint
            : { x: connectOriginX, y: connectSourceNode.y }}
        {@const previewEnd =
          connectDirection === 'back'
            ? { x: connectOriginX, y: connectSourceNode.y }
            : connectPoint}
        <path
          d="M {previewStart.x} {previewStart.y} L {previewEnd.x} {previewEnd.y}"
          fill="none"
          class="stroke-accent"
          stroke-width="2"
          stroke-dasharray="6 5"
          marker-end="url(#cp-graph-arrow-active)"
          pointer-events="none"
        />
      {/if}
      {#each layout.nodes as n (n.id)}
        {@const isTarget = connectSource !== null && connectTarget === n.id}
        {@const pulse = highlightedNodeIds.has(n.id)}
        {@const labelMatch = nodeLabelMatch(n.id)}
        {@const emphasis = isTarget || pulse || labelMatch}
        {@const dimmed = nodeDimmed(n.id)}
        <g
          transform="translate({n.x - NODE_WIDTH / 2} {n.y - NODE_HEIGHT / 2})"
          data-node-id={n.id}
          data-highlight={pulse ? '' : undefined}
          class="group {pulse
            ? 'opacity-100'
            : dimmed
              ? 'opacity-25'
              : n.isDone
                ? 'opacity-60'
                : ''}"
        >
          <rect
            width={NODE_WIDTH}
            height={NODE_HEIGHT}
            rx="10"
            class="fill-surface {emphasis ? 'stroke-accent' : 'stroke-edge'} {pulse
              ? 'cp-node-pulse'
              : ''}"
            stroke-width={isTarget ? 3 : pulse ? 3 : labelMatch ? 2.5 : 1}
          />
          <foreignObject width={NODE_WIDTH} height={NODE_HEIGHT}>
            <a
              use:link
              href="/projects/{projectId}/graph/tasks/{n.id}"
              draggable="false"
              aria-label="Open task {n.title}"
              class="flex h-full w-full cursor-pointer flex-col justify-center gap-1 rounded-[10px] px-3"
            >
              <span class="truncate text-[13px] font-medium {n.isDone ? 'text-muted' : 'text-ink'}">
                {n.title}
              </span>
              <span
                class="max-w-full self-start truncate rounded-full border border-edge bg-canvas px-2 py-0.5 text-[10px] text-muted"
              >
                {n.columnName}
              </span>
            </a>
          </foreignObject>
          <circle
            data-connect-handle={n.id}
            data-connect-dir="front"
            cx={NODE_WIDTH}
            cy={NODE_HEIGHT / 2}
            r="11"
            fill="transparent"
            role="button"
            tabindex="0"
            aria-label="Drag to add a task that {n.title} blocks"
            class="cursor-crosshair {coarsePointer
              ? ''
              : 'pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto'}"
            onpointerdown={(event) => startConnect(event, n.id, 'front')}
          />
          <circle
            cx={NODE_WIDTH}
            cy={NODE_HEIGHT / 2}
            r="5"
            class="fill-accent stroke-surface {coarsePointer
              ? ''
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}"
            stroke-width="1.5"
            pointer-events="none"
          />
          <circle
            data-connect-handle={n.id}
            data-connect-dir="back"
            cx="0"
            cy={NODE_HEIGHT / 2}
            r="11"
            fill="transparent"
            role="button"
            tabindex="0"
            aria-label="Drag to add a task that blocks {n.title}"
            class="cursor-crosshair {coarsePointer
              ? ''
              : 'pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto'}"
            onpointerdown={(event) => startConnect(event, n.id, 'back')}
          />
          <circle
            cx="0"
            cy={NODE_HEIGHT / 2}
            r="5"
            class="fill-surface stroke-accent {coarsePointer
              ? ''
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}"
            stroke-width="2"
            pointer-events="none"
          />
        </g>
      {/each}
      {#if selectedEdge}
        {@const mid = edgeMidpoint(selectedEdge.points)}
        <foreignObject
          x={mid.x - 16}
          y={mid.y - 16}
          width="32"
          height="32"
          class="overflow-visible"
        >
          <button
            type="button"
            aria-label="Remove dependency"
            onpointerdown={(event) => event.stopPropagation()}
            onclick={(event) => deleteEdge(event, selectedEdge)}
            class="flex size-8 cursor-pointer items-center justify-center rounded-full border border-edge bg-danger text-xs text-white shadow"
          >
            ✕
          </button>
        </foreignObject>
      {/if}
    </svg>
    {#if layout.edges.length === 0}
      <div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
        <p
          class="rounded-full border border-edge bg-surface/90 px-4 py-1.5 text-center text-xs text-muted shadow-sm"
        >
          No dependencies yet — drag a node's handle onto another to map how tasks relate.
        </p>
      </div>
    {/if}
  {/if}
</div>

<style>
  @keyframes -global-cp-node-pulse {
    0%,
    100% {
      stroke-opacity: 1;
    }
    50% {
      stroke-opacity: 0.3;
    }
  }
  :global(.cp-node-pulse) {
    animation: cp-node-pulse 0.9s ease-in-out infinite;
  }
</style>
