import { motion } from './motion.svelte';

// The highlight svelte-dnd-action draws on a zone while a drag is live. One
// object for every zone on the board, in the sidebar and on a checklist, so a
// new zone cannot pick up a differently-shaped highlight by copying an older
// call site.
//
// `borderRadius` is here for the outline's sake rather than the element's: the
// zones are transparent containers, and an outline takes its curve from the
// element it surrounds. 6px against the 8px `rounded-lg` of a column: the
// outline sits inside the column's 1px border and 2px further in again, and a
// curve concentric with one 3px outside it is 3px tighter.
export const DROP_TARGET_STYLE = {
  outline: '2px solid var(--cp-accent)',
  outlineOffset: '-2px',
  borderRadius: '0.375rem',
};

const FLIP_MS = 150;

// How long a zone takes to reflow around a dragged item, for the zone itself and
// for the `animate:flip` on its children — the two have to agree or the list
// settles after the item has landed.
//
// A function rather than a constant because the second half is a rule, not a
// number: reduced motion collapses it to zero. A zone that took the constant and
// left the rule behind would animate against the preference on every machine but
// the author's, and nothing would fail. Reactive at the call site, which reads
// `motion.reduced` as it evaluates.
export function flipDuration(): number {
  return motion.reduced ? 0 : FLIP_MS;
}
