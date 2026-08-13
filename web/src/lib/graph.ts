import { Graph, layout as dagreLayout } from '@dagrejs/dagre';
import type { EdgeLabel, GraphLabel, NodeLabel } from '@dagrejs/dagre';
import type { BoardColumn, BoardTask } from './board-types';

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 64;
const NODE_SEP = 24;
const RANK_SEP = 72;

interface GraphNodeBase {
  id: string;
}

export interface TaskGraphNode extends GraphNodeBase {
  kind: 'task';
  title: string;
  columnName: string;
  isDone: boolean;
}

/** An expanded, readable task on another board. Terminal: it carries no count
 *  of its own, so it can never sprout a placeholder and the walk cannot recurse. */
export interface RemoteGraphNode extends GraphNodeBase {
  kind: 'remote';
  title: string;
  projectName: string;
  isDone: boolean;
}

/** Stands for `count` unexpanded blockers on other boards, until it is clicked. */
export interface PlaceholderGraphNode extends GraphNodeBase {
  kind: 'placeholder';
  hostTaskId: string;
  count: number;
}

/** Expanded, but these live in projects the viewer cannot read. Never named. */
export interface HiddenGraphNode extends GraphNodeBase {
  kind: 'hidden';
  hostTaskId: string;
  count: number;
}

// Only `id` is common, which is all adjacency, the topological order, cycle
// detection and layout ever read — so they are untouched by the union.
export type GraphNode = TaskGraphNode | RemoteGraphNode | PlaceholderGraphNode | HiddenGraphNode;

// A uuid never contains ':', so a synthetic id can never collide with a real one.
export const crossProjectNodeId = (taskId: string): string => `xp:${taskId}`;
export const crossProjectHiddenNodeId = (taskId: string): string => `xph:${taskId}`;

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

// An intersection rather than an extends clause: a union cannot be extended,
// and this has to distribute over all four node kinds.
export type LayoutNode = GraphNode & LayoutPoint;

export interface LayoutEdge extends GraphEdge {
  points: LayoutPoint[];
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

export type GraphResult = { kind: 'cycle' } | { kind: 'ok'; layout: GraphLayout };

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Null means the node is already fully visible and no pan is needed.
export function panToNode(vb: ViewBox, node: LayoutPoint): ViewBox | null {
  const visible =
    node.x - NODE_WIDTH / 2 >= vb.x &&
    node.x + NODE_WIDTH / 2 <= vb.x + vb.w &&
    node.y - NODE_HEIGHT / 2 >= vb.y &&
    node.y + NODE_HEIGHT / 2 <= vb.y + vb.h;
  if (visible) {
    return null;
  }
  return { x: node.x - vb.w / 2, y: node.y - vb.h / 2, w: vb.w, h: vb.h };
}

export function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

export interface CrossProjectLoaded {
  tasks: readonly { task_id: string; title: string; project_name: string; is_done: boolean }[];
  hiddenCount: number;
}

export interface CrossProjectExpansion {
  /** Local task ids whose placeholder the viewer has clicked open. */
  expanded: ReadonlySet<string>;
  /** Fetched rows, keyed by the local task they hang off. */
  loaded: ReadonlyMap<string, CrossProjectLoaded>;
}

const NO_CROSS_PROJECT: CrossProjectExpansion = { expanded: new Set(), loaded: new Map() };

export function buildGraph(
  tasks: readonly BoardTask[],
  columns: readonly BoardColumn[],
  // Defaulted so the client-side cycle pre-check keeps calling this with two
  // arguments — and keeps cross-project nodes out of that check, which is right:
  // the server owns the cross-project cycle rules.
  cross: CrossProjectExpansion = NO_CROSS_PROJECT
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const nodes: GraphNode[] = tasks.map((task) => {
    const column = columnById.get(task.column_id);
    return {
      kind: 'task',
      id: task.id,
      title: task.title,
      columnName: column?.name ?? '',
      isDone: column?.is_done ?? false,
    };
  });
  const taskIds = new Set(tasks.map((task) => task.id));
  const edges: GraphEdge[] = [];
  for (const task of tasks) {
    for (const blockerId of new Set(task.blocker_ids)) {
      if (!taskIds.has(blockerId)) continue;
      edges.push({ id: edgeId(blockerId, task.id), from: blockerId, to: task.id });
    }
  }

  // Every synthetic node has in-degree 0 and out-degree 1, so none can sit on a
  // cycle and the cycle code needs no special case. In LR order they land
  // immediately left of their host, which is where blockers belong.
  //
  // One remote task can block several local ones, and each of those hosts expands
  // independently, so the same remote is reached once per host. It gets one node
  // and an edge per host: a second node under the same id is a duplicate key in
  // the graph's `{#each}`, which throws and takes the whole route down.
  const emittedRemoteIds = new Set<string>();
  const emittedEdgeIds = new Set<string>();
  const addCrossProjectEdge = (from: string, to: string): void => {
    const id = edgeId(from, to);
    if (emittedEdgeIds.has(id)) {
      return;
    }
    emittedEdgeIds.add(id);
    edges.push({ id, from, to });
  };
  for (const task of tasks) {
    const count = task.open_cross_project_blocker_count;
    if (count === 0) continue;
    const loaded = cross.expanded.has(task.id) ? cross.loaded.get(task.id) : undefined;
    if (loaded === undefined) {
      const id = crossProjectNodeId(task.id);
      nodes.push({ kind: 'placeholder', id, hostTaskId: task.id, count });
      addCrossProjectEdge(id, task.id);
      continue;
    }
    for (const remote of loaded.tasks) {
      if (!emittedRemoteIds.has(remote.task_id)) {
        emittedRemoteIds.add(remote.task_id);
        nodes.push({
          kind: 'remote',
          id: remote.task_id,
          title: remote.title,
          projectName: remote.project_name,
          isDone: remote.is_done,
        });
      }
      addCrossProjectEdge(remote.task_id, task.id);
    }
    if (loaded.hiddenCount > 0) {
      const id = crossProjectHiddenNodeId(task.id);
      nodes.push({ kind: 'hidden', id, hostTaskId: task.id, count: loaded.hiddenCount });
      addCrossProjectEdge(id, task.id);
    }
  }

  return { nodes, edges };
}

interface Adjacency {
  out: Map<string, string[]>;
  indegree: Map<string, number>;
}

function adjacency(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Adjacency {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const out = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
    indegree.set(edge.to, indegree.get(edge.to)! + 1);
    out.get(edge.from)!.push(edge.to);
  }
  return { out, indegree };
}

function topologicalOrder(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): string[] {
  const { out, indegree } = adjacency(nodes, edges);
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of out.get(id)!) {
      const remaining = indegree.get(next)! - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return order;
}

export function detectCycle(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): boolean {
  return topologicalOrder(nodes, edges).length < nodes.length;
}

// Whatever a topological order cannot place is on a cycle or downstream of one.
export function cycleNodeIds(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[]
): Set<string> {
  const placed = new Set(topologicalOrder(nodes, edges));
  return new Set(nodes.filter((node) => !placed.has(node.id)).map((node) => node.id));
}

// blockedTaskId is repeated as the last element: that final hop is the edge the
// caller is about to create, so the result reads as a closed loop.
export function cyclePathIds(
  edges: readonly GraphEdge[],
  blockedTaskId: string,
  blockerTaskId: string
): string[] {
  const out = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = out.get(edge.from);
    if (targets) {
      targets.push(edge.to);
    } else {
      out.set(edge.from, [edge.to]);
    }
  }

  const predecessors = new Map<string, string>();
  const visited = new Set<string>([blockedTaskId]);
  const queue = [blockedTaskId];

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    for (const next of out.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      predecessors.set(next, current);
      if (next !== blockerTaskId) {
        queue.push(next);
        continue;
      }
      const path = [blockerTaskId];
      for (let node = current; node !== blockedTaskId; node = predecessors.get(node)!) {
        path.push(node);
      }
      path.push(blockedTaskId);
      path.reverse();
      path.push(blockedTaskId);
      return path;
    }
  }

  return [];
}

export function layoutGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): GraphLayout {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }
  const g = new Graph<GraphLabel, NodeLabel, EdgeLabel>();
  g.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 8, marginy: 8 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.from, edge.to);
  }
  dagreLayout(g);
  const positioned = nodes.map((node) => {
    const { x, y } = g.node(node.id);
    return { ...node, x: x ?? 0, y: y ?? 0 };
  });
  const positionedEdges = edges.map((edge) => ({
    ...edge,
    points: (g.edge(edge.from, edge.to).points ?? []).map((p) => ({ x: p.x, y: p.y })),
  }));
  const label = g.graph();
  return {
    nodes: positioned,
    edges: positionedEdges,
    width: label.width ?? 0,
    height: label.height ?? 0,
  };
}

export function computeGraph(
  tasks: readonly BoardTask[],
  columns: readonly BoardColumn[],
  cross: CrossProjectExpansion = NO_CROSS_PROJECT
): GraphResult {
  const { nodes, edges } = buildGraph(tasks, columns, cross);
  if (detectCycle(nodes, edges)) {
    return { kind: 'cycle' };
  }
  return { kind: 'ok', layout: layoutGraph(nodes, edges) };
}

function fmt(point: LayoutPoint): string {
  return `${Math.round(point.x * 100) / 100} ${Math.round(point.y * 100) / 100}`;
}

// Catmull-Rom through the dagre waypoints, converted to cubic Bezier segments.
export function edgePath(points: readonly LayoutPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${fmt(points[0]!)}`;
  const parts = [`M ${fmt(points[0]!)}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(i + 2, points.length - 1)]!;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    parts.push(`C ${fmt(c1)} ${fmt(c2)} ${fmt(p2)}`);
  }
  return parts.join(' ');
}
