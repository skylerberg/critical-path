import '@testing-library/jest-dom/vitest';
// jsdom has no IndexedDB, which the offline snapshot and the mutation queue both
// live in. Imported for its side effect of installing a real implementation, so
// those tests exercise the same code paths a browser would.
import 'fake-indexeddb/auto';
// Must precede every import below that reaches api/client.ts: openapi-fetch
// captures globalThis.fetch and globalThis.Request when the client module is
// evaluated, and the stubs live here. See the note in that file.
import './api/testUtils';
import { afterEach } from 'vitest';
import { connectivity } from './lib/connectivity.svelte';
import { outbox } from './lib/outbox.svelte';

// Reachability is deduced from whether requests get answers, so a test that
// makes fetch reject — several do, deliberately — leaves the app believing it is
// offline. Left alone that would make the *next* test's board mutations queue
// instead of send, which is a confusing way to discover module-level state.
afterEach(() => {
  connectivity.resetForTests();
  outbox.reset();
});

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
