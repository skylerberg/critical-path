import { motion } from './motion.svelte';

// The highlight svelte-dnd-action draws on a zone while a drag is live. Two
// shapes of the same 2px accent ring, one object each rather than one per zone,
// so a new zone cannot pick up a differently-shaped highlight by copying an older
// call site. Which one a zone wants is a question about its box, and
// `INSET_DROP_TARGET_STYLE` below is where that is spelled out.
//
// `borderRadius` is here for the ring's sake rather than the element's: the zones
// are transparent containers, and both shapes take their curve from the element
// they are drawn on. 6px against the 8px `rounded-lg` of a column: the ring sits
// inside the column's 1px border and 2px further in again, and a curve concentric
// with one 3px outside it is 3px tighter.
export const DROP_TARGET_STYLE = {
  outline: '2px solid var(--cp-accent)',
  outlineOffset: '-2px',
  borderRadius: '0.375rem',
};

// For a zone whose box is bigger than the part of it worth ringing. An outline
// traces the BORDER box, and the board's task zone carries its reach under a
// column's cards as a transparent bottom border (`drop-reach` in src/app.css), so
// an outline there draws a box to the foot of the board for the length of every
// drag. An inset shadow traces the padding box, which that border sits outside of,
// so the ring stops where the cards do.
//
// Not the default for every zone, because an inset shadow paints under the zone's
// own content where an outline paints over it: the columns row is a zone whose
// children fill it edge to edge and draw an opaque surface, and a ring inside it
// would be visible only in the gaps between them.
export const INSET_DROP_TARGET_STYLE = {
  boxShadow: 'inset 0 0 0 2px var(--cp-accent)',
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
