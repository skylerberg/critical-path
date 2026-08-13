import { describe, expect, it } from 'vitest';
import type { CycleTask } from './board-types';
import {
  cycleClosingEdge,
  cycleClosingPath,
  cycleEdgeIds,
  cyclePathNodeIds,
  CYCLE_CLOSING_BOW,
  CYCLE_CLOSING_REACH,
} from './graph-cycle';
import { edgeId, NODE_WIDTH, type GraphLayout } from './graph';

function step(id: string | null): CycleTask {
  return { id, title: id ?? null } as CycleTask;
}

function layoutOf(nodes: { id: string; x: number; y: number }[]): GraphLayout {
  return { nodes, edges: [], width: 1000, height: 800 } as unknown as GraphLayout;
}

// The two cubic control points of `M x y C c1x c1y c2x c2y ex ey`.
function controlPoints(d: string): { x: number; y: number }[] {
  const m = /C ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/.exec(d);
  if (m === null) throw new Error(`no cubic in ${d}`);
  return [
    { x: Number(m[1]), y: Number(m[2]) },
    { x: Number(m[3]), y: Number(m[4]) },
  ];
}

describe('cycleNodeIds', () => {
  it('is empty without a reported cycle', () => {
    expect(cyclePathNodeIds(null)).toEqual([]);
    expect(cyclePathNodeIds(undefined)).toEqual([]);
  });

  // A redacted step is on no board this view draws, so it cannot be highlighted.
  // Dropped rather than substituted: a gap would pair the wrong nodes into edges.
  it('drops redacted steps rather than leaving a hole', () => {
    expect(cyclePathNodeIds([step('a'), step(null), step('c')])).toEqual(['a', 'c']);
  });

  it('keeps the repeated closing id, which is what makes it a loop', () => {
    expect(cyclePathNodeIds([step('a'), step('b'), step('a')])).toEqual(['a', 'b', 'a']);
  });
});

describe('cycleEdgeIds', () => {
  it('is every hop but the closing one', () => {
    expect(cycleEdgeIds(['a', 'b', 'c', 'a'])).toEqual(
      new Set([edgeId('a', 'b'), edgeId('b', 'c')])
    );
  });

  it('is the single hop of a two-node loop, the other being the closing one', () => {
    expect(cycleEdgeIds(['a', 'b', 'a'])).toEqual(new Set([edgeId('a', 'b')]));
  });

  it('is empty for nothing at all', () => {
    expect(cycleEdgeIds([])).toEqual(new Set());
  });
});

describe('cycleClosingEdge', () => {
  it('is the last hop of the loop', () => {
    expect(cycleClosingEdge(['a', 'b', 'c', 'a'])).toEqual({ from: 'c', to: 'a' });
  });

  it('is nothing for a chain too short to close', () => {
    expect(cycleClosingEdge([])).toBeNull();
    expect(cycleClosingEdge(['a'])).toBeNull();
    expect(cycleClosingEdge(['a', 'b'])).toBeNull();
  });
});

describe('cycleClosingPath', () => {
  const layout = layoutOf([
    { id: 'a', x: 100, y: 100 },
    { id: 'b', x: 400, y: 100 },
  ]);
  const onCycle = new Set(['a', 'b']);

  it('is nothing without an edge or a layout', () => {
    expect(cycleClosingPath(null, layout, onCycle)).toBeNull();
    expect(cycleClosingPath({ from: 'b', to: 'a' }, null, onCycle)).toBeNull();
  });

  it('is nothing when a named node is not on the drawing', () => {
    expect(cycleClosingPath({ from: 'b', to: 'zz' }, layout, onCycle)).toBeNull();
  });

  it('leaves and enters the faces that point at each other', () => {
    // b is right of a, so the hop runs right-to-left: it leaves b's left face and
    // enters a's right face.
    const d = cycleClosingPath({ from: 'b', to: 'a' }, layout, onCycle);

    expect(d).toMatch(new RegExp(`^M ${String(400 - NODE_WIDTH / 2)} 100 C `));
    expect(d).toMatch(new RegExp(` ${String(100 + NODE_WIDTH / 2)} 100$`));
  });

  // Below the lowest node on the loop — not below its endpoints, which is the
  // easy thing to write and leaves the curve crossing straight through whatever
  // sits between them.
  it('bows below every node on the loop, not just the two it joins', () => {
    const stacked = layoutOf([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 400, y: 260 },
      { id: 'middle', x: 250, y: 400 },
    ]);

    const d = cycleClosingPath({ from: 'b', to: 'a' }, stacked, new Set(['a', 'b', 'middle']))!;

    expect(controlPoints(d).map((p) => p.y)).toEqual([
      400 + CYCLE_CLOSING_BOW,
      400 + CYCLE_CLOSING_BOW,
    ]);
  });

  // Nodes off the loop are irrelevant to where it has to clear, and letting one
  // count would fling the curve to the bottom of an unrelated branch.
  it('ignores nodes that are not on the loop', () => {
    const withBystander = layoutOf([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 400, y: 260 },
      { id: 'elsewhere', x: 700, y: 5000 },
    ]);

    const d = cycleClosingPath({ from: 'b', to: 'a' }, withBystander, new Set(['a', 'b']))!;

    expect(controlPoints(d)[0]?.y).toBe(260 + CYCLE_CLOSING_BOW);
  });

  // The sign flip is the whole reason this is worth testing: mirrored, the
  // control points splay outward instead of pulling in, and the curve crosses
  // back through the very nodes it is meant to run below.
  it('pulls its control points inward, on the side the hop runs', () => {
    const rightToLeft = cycleClosingPath({ from: 'b', to: 'a' }, layout, onCycle)!;
    const leftToRight = cycleClosingPath({ from: 'a', to: 'b' }, layout, onCycle)!;

    expect(controlPoints(rightToLeft).map((p) => p.x)).toEqual([
      400 - NODE_WIDTH / 2 - CYCLE_CLOSING_REACH,
      100 + NODE_WIDTH / 2 + CYCLE_CLOSING_REACH,
    ]);
    expect(controlPoints(leftToRight).map((p) => p.x)).toEqual([
      100 + NODE_WIDTH / 2 + CYCLE_CLOSING_REACH,
      400 - NODE_WIDTH / 2 - CYCLE_CLOSING_REACH,
    ]);
  });

  it('mirrors its endpoints when the loop runs the other way', () => {
    const d = cycleClosingPath({ from: 'a', to: 'b' }, layout, onCycle);

    expect(d).toMatch(new RegExp(`^M ${String(100 + NODE_WIDTH / 2)} 100 C `));
    expect(d).toMatch(new RegExp(` ${String(400 - NODE_WIDTH / 2)} 100$`));
  });
});
