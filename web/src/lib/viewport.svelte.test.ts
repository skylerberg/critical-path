import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Viewport } from './viewport.svelte';

const LAYOUT_H = 800;

// jsdom implements no VisualViewport at all (CLAUDE.md lists what else is
// missing), so the thing under test has to be handed one. An EventTarget with
// the two fields the store reads is the whole of the API surface it uses.
class FakeVisualViewport extends EventTarget {
  height = LAYOUT_H;
  scale = 1;

  resizeTo(height: number, scale = 1): void {
    this.height = height;
    this.scale = scale;
    this.dispatchEvent(new Event('resize'));
  }
}

function property(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

describe('Viewport', () => {
  let visual: FakeVisualViewport;
  let viewport: Viewport;

  beforeEach(() => {
    visual = new FakeVisualViewport();
    Object.defineProperty(window, 'visualViewport', { value: visual, configurable: true });
    // jsdom lays nothing out, so every clientHeight it reports is 0 — including
    // the one standing in for the layout viewport here.
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: LAYOUT_H,
      configurable: true,
    });
    viewport = new Viewport();
  });

  afterEach(() => {
    viewport.dispose();
    Reflect.deleteProperty(window, 'visualViewport');
    Reflect.deleteProperty(document.documentElement, 'clientHeight');
  });

  it('sizes the screen to what the keyboard leaves of it', () => {
    viewport.init();

    visual.resizeTo(444.6);

    expect(viewport.keyboardOpen).toBe(true);
    // Floored, so the page cannot be left the half-pixel of overflow that makes
    // it scrollable again.
    expect(property('--cp-viewport-h')).toBe('444px');
    expect(property('--cp-bottom-nav-h')).toBe('0px');
  });

  it('gives the screen and the bottom nav back when the keyboard goes', () => {
    viewport.init();
    visual.resizeTo(444);

    visual.resizeTo(LAYOUT_H);

    expect(viewport.keyboardOpen).toBe(false);
    // Cleared rather than restored: the stylesheet is what says how tall a
    // screen with nothing over it is.
    expect(property('--cp-viewport-h')).toBe('');
    expect(property('--cp-bottom-nav-h')).toBe('');
  });

  it('reads a keyboard that is already up on the first paint', () => {
    visual.height = 444;

    viewport.init();

    expect(viewport.keyboardOpen).toBe(true);
    expect(property('--cp-viewport-h')).toBe('444px');
  });

  it('does not take a retracting URL bar for a keyboard', () => {
    viewport.init();

    visual.resizeTo(LAYOUT_H - 56);

    expect(viewport.keyboardOpen).toBe(false);
    expect(property('--cp-viewport-h')).toBe('');
  });

  it('leaves a pinch-zoomed page the viewport it asked for', () => {
    viewport.init();

    visual.resizeTo(400, 2);

    expect(viewport.keyboardOpen).toBe(false);
    expect(property('--cp-viewport-h')).toBe('');
  });

  it('stops measuring once disposed', () => {
    viewport.init();
    viewport.dispose();

    visual.resizeTo(444);

    expect(viewport.keyboardOpen).toBe(false);
    expect(property('--cp-viewport-h')).toBe('');
  });

  it('leaves nothing behind when there is no VisualViewport to read', () => {
    Reflect.deleteProperty(window, 'visualViewport');

    viewport.init();

    expect(viewport.keyboardOpen).toBe(false);
    expect(property('--cp-viewport-h')).toBe('');
  });
});
