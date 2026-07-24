import { describe, expect, it } from 'vitest';
import type { BoardColumn, BoardTask } from './board-types';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  buildGraph,
  computeGraph,
  detectCycle,
  edgeId,
  edgePath,
  layoutGraph,
  panToNode,
  type GraphEdge,
  type GraphNode,
  type ViewBox,
} from './graph';

function column(id: string, name: string, isDone = false): BoardColumn {
  return { id, name, position: 1000, is_done: isDone };
}

function task(id: string, columnId: string, blockerIds: string[] = []): BoardTask {
  return {
    id,
    column_id: columnId,
    title: `Task ${id}`,
    description: null,
    position: 1000,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: blockerIds,
    image_count: 0,
  };
}

const columns = [column('todo', 'To Do'), column('done', 'Done', true)];

function node(id: string, isDone = false): GraphNode {
  return { id, title: `Task ${id}`, columnName: isDone ? 'Done' : 'To Do', isDone };
}

function edge(from: string, to: string): GraphEdge {
  return { id: edgeId(from, to), from, to };
}

describe('buildGraph', () => {
  it('maps tasks to nodes with column name and done flag', () => {
    const { nodes } = buildGraph([task('a', 'todo'), task('b', 'done')], columns);

    expect(nodes).toEqual([
      { id: 'a', title: 'Task a', columnName: 'To Do', isDone: false },
      { id: 'b', title: 'Task b', columnName: 'Done', isDone: true },
    ]);
  });

  it('creates blocker -> blocked edges from blocker_ids', () => {
    const { edges } = buildGraph([task('a', 'todo'), task('b', 'todo', ['a'])], columns);

    expect(edges).toEqual([{ id: 'a->b', from: 'a', to: 'b' }]);
  });

  it('skips blockers that are not in the task set and duplicate blocker ids', () => {
    const { edges } = buildGraph(
      [task('a', 'todo'), task('b', 'todo', ['a', 'a', 'missing'])],
      columns
    );

    expect(edges).toEqual([{ id: 'a->b', from: 'a', to: 'b' }]);
  });

  it('handles tasks whose column is unknown', () => {
    const { nodes } = buildGraph([task('a', 'gone')], columns);

    expect(nodes).toEqual([{ id: 'a', title: 'Task a', columnName: '', isDone: false }]);
  });
});

describe('detectCycle', () => {
  it('accepts a chain', () => {
    const nodes = [node('a'), node('b'), node('c')];
    expect(detectCycle(nodes, [edge('a', 'b'), edge('b', 'c')])).toBe(false);
  });

  it('accepts a diamond', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
    expect(detectCycle(nodes, edges)).toBe(false);
  });

  it('flags a two-node cycle and terminates', () => {
    const nodes = [node('a'), node('b')];
    expect(detectCycle(nodes, [edge('a', 'b'), edge('b', 'a')])).toBe(true);
  });

  it('flags a self-loop', () => {
    expect(detectCycle([node('a')], [edge('a', 'a')])).toBe(true);
  });

  it('flags a cycle reachable only from part of the graph', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'b'), edge('a', 'd')];
    expect(detectCycle(nodes, edges)).toBe(true);
  });
});

describe('layoutGraph', () => {
  it('returns an empty layout for no nodes', () => {
    expect(layoutGraph([], [])).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
  });

  it('positions every node with finite coordinates', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];

    const layout = layoutGraph(nodes, edges);

    expect(layout.nodes).toHaveLength(4);
    for (const positioned of layout.nodes) {
      expect(Number.isFinite(positioned.x)).toBe(true);
      expect(Number.isFinite(positioned.y)).toBe(true);
    }
    expect(layout.width).toBeGreaterThanOrEqual(NODE_WIDTH);
    expect(layout.height).toBeGreaterThanOrEqual(NODE_HEIGHT);
  });

  it('flows left to right along dependencies', () => {
    const layout = layoutGraph([node('a'), node('b')], [edge('a', 'b')]);

    const a = layout.nodes.find((n) => n.id === 'a')!;
    const b = layout.nodes.find((n) => n.id === 'b')!;
    expect(a.x).toBeLessThan(b.x);
  });

  it('returns edge waypoints with finite coordinates', () => {
    const layout = layoutGraph([node('a'), node('b')], [edge('a', 'b')]);

    expect(layout.edges).toHaveLength(1);
    const points = layout.edges[0]!.points;
    expect(points.length).toBeGreaterThanOrEqual(2);
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });
});

describe('computeGraph', () => {
  it('returns a cycle marker without layout on cyclic data', () => {
    const tasks = [task('a', 'todo', ['b']), task('b', 'todo', ['a'])];
    expect(computeGraph(tasks, columns)).toEqual({ kind: 'cycle' });
  });

  it('returns a layout for a DAG', () => {
    const tasks = [task('a', 'todo'), task('b', 'todo', ['a']), task('c', 'done', ['b'])];

    const result = computeGraph(tasks, columns);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.layout.nodes).toHaveLength(3);
    expect(result.layout.edges).toHaveLength(2);
  });
});

describe('panToNode', () => {
  const vb: ViewBox = { x: 0, y: 0, w: 640, h: 480 };

  it('returns null when the node is fully inside the viewBox', () => {
    expect(panToNode(vb, { x: 320, y: 240 })).toBeNull();
  });

  it('returns null when the node exactly touches the viewBox edges', () => {
    expect(panToNode(vb, { x: NODE_WIDTH / 2, y: NODE_HEIGHT / 2 })).toBeNull();
    expect(panToNode(vb, { x: 640 - NODE_WIDTH / 2, y: 480 - NODE_HEIGHT / 2 })).toBeNull();
  });

  it('centers on a node beyond the right edge, keeping the zoom', () => {
    expect(panToNode(vb, { x: 1000, y: 240 })).toEqual({ x: 680, y: 0, w: 640, h: 480 });
  });

  it('centers on a node above and left of the viewBox', () => {
    expect(panToNode(vb, { x: -50, y: -60 })).toEqual({ x: -370, y: -300, w: 640, h: 480 });
  });

  it('pans when the node is only partially visible', () => {
    const clipped = { x: 640 - NODE_WIDTH / 2 + 1, y: 240 };
    expect(panToNode(vb, clipped)).toEqual({ x: clipped.x - 320, y: 0, w: 640, h: 480 });
  });

  it('honors a non-origin viewBox offset', () => {
    const offset: ViewBox = { x: 500, y: 300, w: 640, h: 480 };
    expect(panToNode(offset, { x: 820, y: 540 })).toBeNull();
    expect(panToNode(offset, { x: 200, y: 100 })).toEqual({ x: -120, y: -140, w: 640, h: 480 });
  });
});

describe('edgePath', () => {
  it('returns an empty string for no points', () => {
    expect(edgePath([])).toBe('');
  });

  it('builds a single cubic segment between two points', () => {
    const d = edgePath([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);

    expect(d).toBe('M 0 0 C 16.67 8.33 83.33 41.67 100 50');
  });

  it('builds one cubic segment per span with finite numbers', () => {
    const d = edgePath([
      { x: 0, y: 0 },
      { x: 50, y: 80 },
      { x: 120, y: 20 },
      { x: 200, y: 60 },
    ]);

    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.match(/C /g)).toHaveLength(3);
    expect(d).not.toMatch(/NaN|Infinity/);
  });
});
