import { describe, expect, it } from 'vitest';
import { crossProjectTotal } from './cross-project-counts';
import type { CrossProjectDependencies } from './crossProjectDeps.svelte';

function deps(over: Partial<CrossProjectDependencies> = {}): CrossProjectDependencies {
  return {
    blocked_by: [],
    blocking: [],
    hidden_blocked_by_count: 0,
    hidden_blocking_count: 0,
    ...over,
  } as CrossProjectDependencies;
}

const edge = { task_id: 't', title: 'x' } as CrossProjectDependencies['blocked_by'][number];

describe('crossProjectTotal before the payload lands', () => {
  // The card decides whether to render its Dependencies section from this, so
  // getting it wrong here is a section that pops in a moment later.
  it('uses the board’s estimate so the section is reserved', () => {
    expect(crossProjectTotal({ deps: null, anonymous: false, openBlockerCount: 3 })).toBe(3);
  });

  it('is nothing for a card the board counted no open blockers on', () => {
    expect(crossProjectTotal({ deps: null, anonymous: false, openBlockerCount: 0 })).toBe(0);
  });

  // A public reader is served no cross-project payload at all, so nothing is
  // outstanding. Using the estimate would reserve a section that never fills.
  it('ignores the estimate for a public reader', () => {
    expect(crossProjectTotal({ deps: null, anonymous: true, openBlockerCount: 4 })).toBe(0);
  });
});

describe('crossProjectTotal once the payload has landed', () => {
  it('counts both directions', () => {
    expect(
      crossProjectTotal({
        deps: deps({ blocked_by: [edge, edge], blocking: [edge] }),
        anonymous: false,
        openBlockerCount: 0,
      })
    ).toBe(3);
  });

  // Edges on projects this account cannot see arrive as a count rather than as
  // rows, and they are still dependencies the card has.
  it('includes the edges it is only told the number of', () => {
    expect(
      crossProjectTotal({
        deps: deps({
          blocked_by: [edge],
          hidden_blocked_by_count: 4,
          blocking: [edge],
          hidden_blocking_count: 2,
        }),
        anonymous: false,
        openBlockerCount: 0,
      })
    ).toBe(8);
  });

  // The estimate counts OPEN blocked-by edges; the payload lists every edge in
  // both directions. They disagree routinely, and the payload is the authority.
  it('drops the board’s estimate rather than blending the two', () => {
    expect(crossProjectTotal({ deps: deps(), anonymous: false, openBlockerCount: 7 })).toBe(0);
  });

  it('counts a done blocker the estimate had already dropped', () => {
    expect(
      crossProjectTotal({
        deps: deps({ blocked_by: [edge] }),
        anonymous: false,
        openBlockerCount: 0,
      })
    ).toBe(1);
  });
});
