<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { board } from '../lib/board.svelte';
  import { link, router } from '../lib/router.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import { NODE_HEIGHT, NODE_WIDTH, computeGraph, edgePath, type GraphResult } from '../lib/graph';
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';

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

  $effect(() => {
    const id = projectId;
    untrack(() => void board.load(id));
  });

  const ready = $derived(
    board.currentProjectId === projectId && !board.loading && board.error === null
  );
  const result: GraphResult | null = $derived(
    ready ? computeGraph(board.tasks, board.columns) : null
  );
  const layout = $derived(result?.kind === 'ok' ? result.layout : null);
  const criticalNodeIds = $derived(
    new Set<string>(result?.kind === 'ok' ? result.critical.nodeIds : [])
  );
  const criticalEdgeIds = $derived(
    new Set<string>(result?.kind === 'ok' ? result.critical.edgeIds : [])
  );
  const normalEdges = $derived(layout?.edges.filter((e) => !criticalEdgeIds.has(e.id)) ?? []);
  const criticalEdges = $derived(layout?.edges.filter((e) => criticalEdgeIds.has(e.id)) ?? []);
  const isGraphView = $derived(router.current.name === 'graph');
  const projectName = $derived(ready ? (board.project?.name ?? '') : '');

  let cycleToastedFor: string | null = null;
  $effect(() => {
    if (result?.kind === 'cycle' && cycleToastedFor !== projectId) {
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

  function openTask(taskId: string): void {
    if (didDrag) return;
    router.navigate(`/projects/${projectId}/tasks/${taskId}`);
  }

  function onNodeKeydown(e: KeyboardEvent, taskId: string): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      router.navigate(`/projects/${projectId}/tasks/${taskId}`);
    }
  }

  function retry(): void {
    void board.refetch();
  }

  function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
</script>

<div class="flex h-[calc(100dvh-4rem)] flex-col lg:h-dvh">
  <header class="flex items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-2">
    <h1 class="min-w-0 flex-1 truncate text-lg font-semibold">{projectName}</h1>
    <nav
      use:link
      aria-label="Project views"
      class="flex shrink-0 rounded-lg border border-edge bg-canvas p-1"
    >
      <a
        href="/projects/{projectId}"
        aria-current={isGraphView ? undefined : 'page'}
        class="flex min-h-11 items-center rounded-md px-4 text-sm font-medium {isGraphView
          ? 'text-muted hover:text-ink'
          : 'bg-surface text-ink shadow-sm'}"
      >
        Board
      </a>
      <a
        href="/projects/{projectId}/graph"
        aria-current={isGraphView ? 'page' : undefined}
        class="flex min-h-11 items-center rounded-md px-4 text-sm font-medium {isGraphView
          ? 'bg-surface text-ink shadow-sm'
          : 'text-muted hover:text-ink'}"
      >
        Graph
      </a>
    </nav>
  </header>

  <div class="relative min-h-0 flex-1 overflow-hidden">
    {#if board.error !== null && board.currentProjectId === projectId}
      <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p class="text-muted">{board.error}</p>
        <Button variant="secondary" onclick={retry}>Retry</Button>
      </div>
    {:else if result === null}
      <div class="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    {:else if result.kind === 'cycle'}
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
          <a href="/projects/{projectId}" class="text-accent underline">board</a>, then link them
          with blockers to see the dependency graph.
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
          {@const pill = truncate(n.columnName, 18)}
          {@const pillWidth = pill.length * 5.8 + 14}
          <g
            transform="translate({n.x - NODE_WIDTH / 2} {n.y - NODE_HEIGHT / 2})"
            data-node-id={n.id}
            role="button"
            tabindex="0"
            aria-label="Open task {n.title}"
            class="cursor-pointer {n.isDone ? 'opacity-60' : ''}"
            onclick={() => openTask(n.id)}
            onkeydown={(e) => onNodeKeydown(e, n.id)}
          >
            <rect
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx="10"
              class="fill-surface {critical ? 'stroke-accent' : 'stroke-edge'}"
              stroke-width={critical ? 2.5 : 1}
            />
            <text
              x="12"
              y="26"
              class="{n.isDone ? 'fill-muted' : 'fill-ink'} text-[13px] font-medium"
            >
              {truncate(n.title, 22)}
            </text>
            <rect
              x="12"
              y="36"
              width={pillWidth}
              height="18"
              rx="9"
              class="fill-canvas stroke-edge"
              stroke-width="1"
            />
            <text
              x={12 + pillWidth / 2}
              y="45"
              text-anchor="middle"
              dominant-baseline="central"
              class="fill-muted text-[10px]"
            >
              {pill}
            </text>
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
</div>
