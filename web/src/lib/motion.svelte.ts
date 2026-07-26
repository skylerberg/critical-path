const QUERY = '(prefers-reduced-motion: reduce)';

export class MotionPreference {
  reduced = $state(false);
  #stop: (() => void) | null = null;

  init(): void {
    // jsdom implements no matchMedia at all, so this guard is load-bearing in tests.
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia(QUERY);
    this.reduced = query.matches;
    const update = (event: MediaQueryListEvent): void => {
      this.reduced = event.matches;
    };
    query.addEventListener('change', update);
    this.#stop = () => query.removeEventListener('change', update);
  }

  dispose(): void {
    this.#stop?.();
    this.#stop = null;
  }
}

export const motion = new MotionPreference();
