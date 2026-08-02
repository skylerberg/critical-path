import '@testing-library/jest-dom/vitest';

// jsdom implements neither scrolling nor the Web Animations API, and Svelte's
// flip animation asks an element what it is already animating.
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.scrollTo ??= () => {};
Element.prototype.getAnimations ??= () => [];

// jsdom has no layout, so a Range has none of the rect APIs ProseMirror calls
// while scrolling the caret into view.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

// Nothing is ever really selected in jsdom, and collapsing an empty selection
// throws there rather than doing nothing — which Tiptap does after inserting a
// mention.
const collapseToEnd = Selection.prototype.collapseToEnd;
Selection.prototype.collapseToEnd = function collapse(this: Selection): void {
  if (this.rangeCount > 0) {
    collapseToEnd.call(this);
  }
};
