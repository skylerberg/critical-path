/**
 * One answer to "can we reach the server right now", because the app otherwise
 * has three that disagree.
 *
 * `navigator.onLine` knows about the network interface and nothing about whether
 * anything is listening, so it only seeds and hints. What counts as proof is
 * traffic that arrived: an HTTP request that got any answer at all — including a
 * 500 — and any frame off the WebSocket. A fetch that rejects is the one thing
 * that proves the negative, and only when it rejected for want of an answer
 * rather than because it was aborted.
 *
 * Both proofs are needed, and each covers the gap the other leaves. The board's
 * revalidating reads are skipped for exactly as long as the socket is carrying
 * the project's events, so a healthy socket is also the state in which HTTP goes
 * quiet — and it heartbeats, so it answers this on its own while it does. A
 * socket that cannot connect takes that suppression with it, and the reads come
 * back. There is deliberately no timer polling for this: neither regime leaves
 * the question unanswered, and a poll of one's own would spend a request per
 * check to learn what arriving traffic already says.
 *
 * `realtime.interrupted` is a different question and stays separate — whether
 * live updates are flowing, not whether the server can be reached. It is latched
 * behind a delay so it stays quiet during an ordinary handshake.
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

  // Tests own the window listeners they install. `onReachable` is deliberately
  // left alone: it is wired once when the outbox is constructed, and clearing it
  // between tests would quietly disable draining for every test after the first.
  resetForTests(): void {
    this.stop();
    this.reachable = true;
  }
}

export const connectivity = new ConnectivityStore();
