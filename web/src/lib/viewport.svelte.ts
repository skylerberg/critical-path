// What is actually on screen, for the screens that size themselves to fill it.
//
// A software keyboard shrinks the *visual* viewport and leaves the *layout*
// viewport alone, and every CSS viewport unit — `dvh` included, whose dynamism
// is about the URL bar and nothing else — measures the layout one. So a shell
// sized `100dvh` keeps a keyboard-sized strip of itself below the fold the
// moment a field is focused, and the board screen, which fits exactly by
// construction, turns into something to scroll.
//
// The engines offer a way out of this and it is not portable: the viewport
// meta's `interactive-widget=resizes-content` makes the browser shrink the
// layout viewport itself, which would need no script at all, and WebKit
// implements none of it — leaving iOS, where most of the reports here come
// from, on the default `resizes-visual`. Measuring the visual viewport is the
// one mechanism both engines have, so it is the only one used: the meta tag is
// deliberately left at its default so there is a single behaviour to reason
// about rather than one per engine.
//
// `--cp-bottom-nav-h` goes to zero alongside, because a keyboard takes the
// fixed bottom nav with it: the nav is positioned against the layout viewport,
// so it sits behind the keyboard where nothing can reach it.
// src/components/Nav.svelte stops drawing it (`keyboardOpen`) and this stops the
// rest of the app reserving its height — one is not much use without the other.

const HEIGHT_PROPERTY = '--cp-viewport-h';
const NAV_PROPERTY = '--cp-bottom-nav-h';

// A keyboard is not the only thing that parts the two viewports, and the other
// two must not take the bottom nav off the screen: a retracting URL bar parts
// them by around 56px, and pinch-zoom parts them by however far the user
// zoomed. So a keyboard is believed only past a gap no browser chrome reaches,
// and never while the page is zoomed — where a short visual viewport is the
// point of the gesture rather than something to design around.
const KEYBOARD_MIN_INSET_PX = 120;
const UNZOOMED_MAX_SCALE = 1.01;

export class Viewport {
  keyboardOpen = $state(false);
  #stop: (() => void) | null = null;

  init(): void {
    const visual = window.visualViewport;
    // Absent under jsdom; see CLAUDE.md on what the runner does not implement.
    if (!visual) {
      return;
    }
    const measure = (): void => this.#measure(visual);
    visual.addEventListener('resize', measure);
    // A reload with the keyboard already up restores a focused field on iOS, so
    // the first reading cannot wait for a resize that has already happened.
    measure();
    this.#stop = () => visual.removeEventListener('resize', measure);
  }

  dispose(): void {
    this.#stop?.();
    this.#stop = null;
    this.keyboardOpen = false;
    document.documentElement.style.removeProperty(HEIGHT_PROPERTY);
    document.documentElement.style.removeProperty(NAV_PROPERTY);
  }

  #measure(visual: VisualViewport): void {
    const root = document.documentElement;
    // The root's clientHeight rather than `innerHeight`, which is the same
    // number right up until it is not: iOS has shipped versions where it shrinks
    // with the keyboard, one where it shrank only after a scroll, and one where
    // it held still. A gap measured against a moving reference closes, and this
    // whole fix would then quietly never engage on the engine it exists for.
    // The layout viewport is the thing iOS documents as not moving.
    const inset = root.clientHeight - visual.height;
    const open = visual.scale <= UNZOOMED_MAX_SCALE && inset >= KEYBOARD_MIN_INSET_PX;
    this.keyboardOpen = open;
    if (!open) {
      // Removed rather than set back to `100dvh`: the stylesheet owns the
      // resting value, and a screen that stops matching it should not have to
      // be found here as well.
      root.style.removeProperty(HEIGHT_PROPERTY);
      root.style.removeProperty(NAV_PROPERTY);
      return;
    }
    // Floored: the visible height is fractional on most devices, and rounding it
    // up hands the page a half-pixel of overflow, which is the whole of the bug
    // this is here to remove.
    root.style.setProperty(HEIGHT_PROPERTY, `${Math.floor(visual.height)}px`);
    root.style.setProperty(NAV_PROPERTY, '0px');
  }
}

export const viewport = new Viewport();
