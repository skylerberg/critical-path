import { accentProperty } from './accents';

const DARK_QUERY = '(prefers-color-scheme: dark)';

// The chrome colour with no board open. A token rather than a literal, so the
// address bar follows the scheme the way every other surface does.
const DEFAULT_PROPERTY = '--cp-accent';

export class ThemeColor {
  #property = DEFAULT_PROPERTY;
  #shipped: string | null = null;
  #stop: (() => void) | null = null;

  init(): void {
    // jsdom implements no matchMedia at all, so this guard is load-bearing in tests.
    if (typeof window.matchMedia === 'function') {
      const query = window.matchMedia(DARK_QUERY);
      const repaint = (): void => this.#paint();
      query.addEventListener('change', repaint);
      this.#stop = () => query.removeEventListener('change', repaint);
    }
    this.#paint();
  }

  dispose(): void {
    this.#stop?.();
    this.#stop = null;
  }

  set(color: string | null | undefined): void {
    this.#property = accentProperty(color) ?? DEFAULT_PROPERTY;
    this.#paint();
  }

  reset(): void {
    this.set(null);
  }

  // Every repaint re-resolves rather than caching a hex: each token carries a
  // light and a dark value, and nothing else re-renders a meta tag.
  #paint(): void {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta === null) {
      return;
    }
    // Captured before the first overwrite: where no stylesheet is applied every
    // token resolves to nothing, and the document's own value beats an empty tag.
    this.#shipped ??= meta.content;
    const resolved = getComputedStyle(document.documentElement)
      .getPropertyValue(this.#property)
      .trim();
    meta.content = resolved === '' ? this.#shipped : resolved;
  }
}

export const themeColor = new ThemeColor();
