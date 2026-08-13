import type { CrossProjectDependencies } from './crossProjectDeps.svelte';

/**
 * How many cross-project dependencies the open card has, in both directions.
 *
 * The card uses this to decide whether to render its Dependencies section at
 * all, which is why the answer has to be right *before* the fetch answers: a
 * section that pops in once the payload lands is the flicker this replaces.
 *
 * Two asymmetries make it easy to "tidy" into a bug:
 *
 * - While the fetch is outstanding the answer is the board payload's estimate,
 *   which counts OPEN blocked-by edges only. There is no equivalent count for
 *   the outgoing side, so that side contributes nothing until the payload lands.
 * - A public reader is served no cross-project payload at all. Nothing is
 *   outstanding for them, so the estimate must not be used either — treating
 *   them as pending leaves the section reserved forever.
 *
 * Once the payload lands it is the authority and the estimate is dropped, not
 * blended: the two disagree routinely, since one counts open edges and the other
 * lists every edge.
 */
export function crossProjectTotal(opts: {
  deps: CrossProjectDependencies | null;
  anonymous: boolean;
  openBlockerCount: number;
}): number {
  const { deps, anonymous, openBlockerCount } = opts;
  if (deps === null) {
    return anonymous ? 0 : openBlockerCount;
  }
  return (
    deps.blocked_by.length +
    deps.hidden_blocked_by_count +
    deps.blocking.length +
    deps.hidden_blocking_count
  );
}
