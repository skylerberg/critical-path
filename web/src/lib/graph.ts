import { Graph, layout as dagreLayout } from '@dagrejs/dagre';
import type { EdgeLabel, GraphLabel, NodeLabel } from '@dagrejs/dagre';
import type { BoardColumn, BoardTask } from './board-types';

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 64;
const NODE_SEP = 24;
const RANK_SEP = 72;

export interface GraphNode {
  id: string;
  title: string;
  columnName: string;
  isDone: boolean;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutNode extends GraphNode {
  x: number;
  y: number;
}

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

export function buildGraph(
  tasks: readonly BoardTask[],
  columns: readonly BoardColumn[]
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const nodes = tasks.map((task) => {
    const column = columnById.get(task.column_id);
    return {
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
  columns: readonly BoardColumn[]
): GraphResult {
  const { nodes, edges } = buildGraph(tasks, columns);
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
