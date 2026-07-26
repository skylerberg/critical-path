import { describe, it, expect } from 'vitest';
import { cyclePathIds, type DependencyEdge } from '../../src/services/dependencies';

function edge(blocker: string, blocked: string): DependencyEdge {
  return { blocker_task_id: blocker, blocked_task_id: blocked };
}

describe('cyclePathIds', () => {
  it('returns an empty path when there are no edges', () => {
    expect(cyclePathIds([], 'A', 'B')).toEqual([]);
  });

  it('returns an empty path when the blocker is unreachable', () => {
    expect(cyclePathIds([edge('A', 'B'), edge('B', 'C')], 'C', 'A')).toEqual([]);
  });

  it('names a direct two-task loop', () => {
    expect(cyclePathIds([edge('A', 'B')], 'A', 'B')).toEqual(['A', 'B', 'A']);
  });

  it('names a transitive loop in blocks order', () => {
    const edges = [edge('A', 'B'), edge('B', 'C')];
    expect(cyclePathIds(edges, 'A', 'C')).toEqual(['A', 'B', 'C', 'A']);
  });

  it('reports the shortest loop when two routes exist', () => {
    const edges = [edge('A', 'B'), edge('B', 'C'), edge('A', 'C')];
    expect(cyclePathIds(edges, 'A', 'C')).toEqual(['A', 'C', 'A']);
  });

  it('terminates on an edge set that already contains an unrelated cycle', () => {
    const edges = [edge('X', 'Y'), edge('Y', 'X'), edge('A', 'B'), edge('B', 'C')];
    expect(cyclePathIds(edges, 'A', 'C')).toEqual(['A', 'B', 'C', 'A']);
  });

  it('terminates when the start node sits on a pre-existing cycle', () => {
    const edges = [edge('A', 'B'), edge('B', 'A'), edge('B', 'C')];
    expect(cyclePathIds(edges, 'A', 'C')).toEqual(['A', 'B', 'C', 'A']);
  });

  it('repeats the start node exactly twice and every other node once', () => {
    const edges = [edge('A', 'B'), edge('B', 'C'), edge('C', 'D'), edge('D', 'B')];
    const path = cyclePathIds(edges, 'A', 'D');
    expect(path).toEqual(['A', 'B', 'C', 'D', 'A']);
    const counts = new Map<string, number>();
    for (const id of path) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.get('A')).toBe(2);
    expect([...counts.values()].filter((count) => count > 1)).toHaveLength(1);
  });
});
