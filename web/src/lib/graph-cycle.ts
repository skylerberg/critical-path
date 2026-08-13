import type { CycleTask } from './board-types';
import { edgeId, NODE_WIDTH, type GraphLayout } from './graph';

/**
 * Everything the graph needs to draw a reported dependency cycle. Pure, and so
 * testable — the bow below is the kind of geometry that is only ever wrong by a
 * sign, which no assertion inside the component could catch.
 */

// Every edge on the loop runs low rank to high rank, so the closing hop runs
// backwards: it leaves and enters the faces that point at each other and swings
// below the loop's row, where a straight line would instead lie along the very
// edges it has to be told apart from, behind the nodes and arrowhead first.
export const CYCLE_CLOSING_BOW = 72;
export const CYCLE_CLOSING_REACH = 60;

/**
 * A redacted step carries no id and is on no board this view draws, so it cannot
 * be highlighted. Dropped rather than substituted: leaving a gap in the chain
 * would pair the wrong nodes into edges.
 */
export function cycleNodeIds(path: readonly CycleTask[] | null | undefined): string[] {
  return path?.flatMap((step) => (step.id === null ? [] : [step.id])) ?? [];
}

/** Every pair but the last: the closing hop is the edge that does not exist yet. */
export function cycleEdgeIds(ids: readonly string[]): Set<string> {
  return new Set(ids.slice(0, -2).map((id, i) => edgeId(id, ids[i + 1]!)));
}

export function cycleClosingEdge(ids: readonly string[]): { from: string; to: string } | null {
  return ids.length >= 3 ? { from: ids.at(-2)!, to: ids.at(-1)! } : null;
}

export function cycleClosingPath(
  edge: { from: string; to: string } | null,
  layout: GraphLayout | null,
  onCycle: ReadonlySet<string>
): string | null {
  if (edge === null || layout === null) return null;
  const from = layout.nodes.find((n) => n.id === edge.from);
  const to = layout.nodes.find((n) => n.id === edge.to);
  if (from === undefined || to === undefined) return null;
  const side = from.x > to.x ? -1 : 1;
  const start = { x: from.x + (side * NODE_WIDTH) / 2, y: from.y };
  const end = { x: to.x - (side * NODE_WIDTH) / 2, y: to.y };
  const bowY =
    Math.max(...layout.nodes.filter((n) => onCycle.has(n.id)).map((n) => n.y)) + CYCLE_CLOSING_BOW;
  const reach = side * CYCLE_CLOSING_REACH;
  return `M ${start.x} ${start.y} C ${start.x + reach} ${bowY} ${end.x - reach} ${bowY} ${end.x} ${end.y}`;
}
