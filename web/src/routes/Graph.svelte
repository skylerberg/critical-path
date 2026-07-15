<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import { board } from '../lib/board.svelte';
  import { link } from '../lib/router.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import { NODE_HEIGHT, NODE_WIDTH, computeGraph, edgePath, type GraphResult } from '../lib/graph';

  interface Props {
    projectId: string;
  }

  let { projectId }: Props = $props();

  interface ViewBox {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  const MIN_VB_WIDTH = 160;
  const FIT_PADDING = 32;
  const FIT_MIN_WIDTH = 640;

  const result: GraphResult = $derived(computeGraph(board.tasks, board.columns));
  const layout = $derived(result.kind === 'ok' ? result.layout : null);
  const criticalNodeIds = $derived(
    new Set<string>(result.kind === 'ok' ? result.critical.nodeIds : [])
  );
  const criticalEdgeIds = $derived(
    new Set<string>(result.kind === 'ok' ? result.critical.edgeIds : [])
  );
  const normalEdges = $derived(layout?.edges.filter((e) => !criticalEdgeIds.has(e.id)) ?? []);
  const criticalEdges = $derived(layout?.edges.filter((e) => criticalEdgeIds.has(e.id)) ?? []);

  let cycleToastedFor: string | null = null;
  $effect(() => {
    if (result.kind === 'cycle' && cycleToastedFor !== projectId) {
      cycleToastedFor = projectId;
      toasts.error('Dependency cycle detected — the graph cannot be drawn.');
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
    if (e.pointerType === 'mouse' && e.button !== 0) return;
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
</script>

<div class="relative min-h-0 flex-1 overflow-hidden">
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
          id="cp-graph-arrow-critical"
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
      {#each normalEdges as e (e.id)}
        <path
          d={edgePath(e.points)}
          fill="none"
          class="stroke-muted opacity-50"
          stroke-width="1.5"
          marker-end="url(#cp-graph-arrow)"
        />
      {/each}
      {#each criticalEdges as e (e.id)}
        <path
          d={edgePath(e.points)}
          fill="none"
          class="stroke-accent"
          stroke-width="2.5"
          marker-end="url(#cp-graph-arrow-critical)"
        />
      {/each}
      {#each layout.nodes as n (n.id)}
        {@const critical = criticalNodeIds.has(n.id)}
        <g
          transform="translate({n.x - NODE_WIDTH / 2} {n.y - NODE_HEIGHT / 2})"
          data-node-id={n.id}
          class={n.isDone ? 'opacity-60' : ''}
        >
          <rect
            width={NODE_WIDTH}
            height={NODE_HEIGHT}
            rx="10"
            class="fill-surface {critical ? 'stroke-accent' : 'stroke-edge'}"
            stroke-width={critical ? 2.5 : 1}
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
        </g>
      {/each}
    </svg>
    {#if layout.edges.length === 0}
      <div class="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4">
        <p
          class="rounded-full border border-edge bg-surface/90 px-4 py-1.5 text-center text-xs text-muted shadow-sm"
        >
          No dependencies yet — open a task and add blockers to map the critical path.
        </p>
      </div>
    {/if}
    {#if criticalNodeIds.size > 0}
      <div
        class="pointer-events-none absolute top-3 right-3 flex items-center gap-2 rounded-full border border-edge bg-surface/90 px-3 py-1.5 text-xs font-medium text-muted shadow-sm"
      >
        <span class="inline-block h-0.5 w-5 rounded bg-accent"></span>
        Critical path
      </div>
    {/if}
  {/if}
</div>
