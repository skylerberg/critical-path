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
