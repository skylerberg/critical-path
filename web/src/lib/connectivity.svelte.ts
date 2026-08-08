/**
 * One answer to "can we reach the server right now", because the app otherwise
 * has three that disagree.
 *
 * `navigator.onLine` knows about the network interface and nothing about
 * whether anything is listening. `realtime.interrupted` tracks the WebSocket,
 * which can be down behind a proxy that passes HTTP perfectly well, and is
 * latched behind a delay so it stays quiet during an ordinary handshake. Neither
 * answers the question the outbox actually has, which is whether writes are
 * landing.
 *
 * So the authority here is the HTTP client: a request that got any answer at all
 * — including a 500 — proves the server is reachable, and a fetch that rejects
 * proves it is not. `navigator` events only seed and hint.
 */
class ConnectivityStore {
  reachable = $state(true);

  /**
   * Set by the outbox so a returning network drains the queue. A field rather
   * than a subscriber list because there is exactly one consumer, matching how
   * `router.beforeNavigate` is wired.
   */
  onReachable: (() => void) | undefined;

  #started = false;

  start(): void {
    if (this.#started || typeof window === 'undefined') {
      return;
    }
    this.#started = true;
    this.reachable = navigator.onLine;
    window.addEventListener('offline', this.#handleOffline);
    window.addEventListener('online', this.#handleOnline);
  }

  stop(): void {
    if (!this.#started) {
      return;
    }
    this.#started = false;
    window.removeEventListener('offline', this.#handleOffline);
    window.removeEventListener('online', this.#handleOnline);
  }

  // The server answered, whatever it said. Nothing else is proof.
  noteReached(): void {
    this.#become(true);
  }

  noteUnreachable(): void {
    this.#become(false);
  }

  #handleOffline = (): void => {
    // Trustworthy in this direction only: no interface means no request.
    this.#become(false);
  };

  #handleOnline = (): void => {
    // A hint, not proof — the interface is back, which says nothing about the
    // server. Treating it as reachable lets the drain run, and the drain is what
    // settles the question honestly.
    this.#become(true);
  };

  #become(reachable: boolean): void {
    const returned = reachable && !this.reachable;
    this.reachable = reachable;
    if (returned) {
      this.onReachable?.();
    }
  }

  // Tests own the window listeners they install.
  resetForTests(): void {
    this.stop();
    this.onReachable = undefined;
    this.reachable = true;
  }
}

export const connectivity = new ConnectivityStore();
