import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectivity } from './connectivity.svelte';

function setOnLine(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

describe('connectivity', () => {
  beforeEach(() => {
    connectivity.resetForTests();
    setOnLine(true);
  });

  afterEach(() => {
    connectivity.resetForTests();
    setOnLine(true);
  });

  it('starts from the interface and then stops listening to it', () => {
    setOnLine(false);
    connectivity.start();
    expect(connectivity.reachable).toBe(false);

    connectivity.stop();
    window.dispatchEvent(new Event('online'));
    expect(connectivity.reachable).toBe(false);
  });

  it('treats losing the interface as proof and regaining it as a hint', () => {
    connectivity.start();

    window.dispatchEvent(new Event('offline'));
    expect(connectivity.reachable).toBe(false);

    window.dispatchEvent(new Event('online'));
    expect(connectivity.reachable).toBe(true);
  });

  it('takes an answer over the interface, whichever came last', () => {
    connectivity.start();
    window.dispatchEvent(new Event('offline'));

    connectivity.noteReached();

    expect(connectivity.reachable).toBe(true);
  });

  describe('onReachable', () => {
    let onReachable: ReturnType<typeof vi.fn<() => void>>;
    let previous: (() => void) | undefined;

    beforeEach(() => {
      previous = connectivity.onReachable;
      onReachable = vi.fn<() => void>();
      connectivity.onReachable = onReachable;
    });

    afterEach(() => {
      connectivity.onReachable = previous;
    });

    it('fires on the way back and not on every proof after it', () => {
      connectivity.noteUnreachable();

      connectivity.noteReached();
      expect(onReachable).toHaveBeenCalledOnce();

      // The socket heartbeats, so this arrives every 30s for as long as it is
      // up. Draining the queue on each one would be a request storm.
      connectivity.noteReached();
      connectivity.noteReached();
      expect(onReachable).toHaveBeenCalledOnce();
    });

    it('does not fire when reachability never lapsed', () => {
      connectivity.noteReached();
      expect(onReachable).not.toHaveBeenCalled();
    });
  });
});
