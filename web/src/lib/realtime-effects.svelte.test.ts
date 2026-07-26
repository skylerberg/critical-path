// The `.svelte.` infix is load-bearing: without it the runes below are not compiled.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { realtime } from './realtime.svelte';

beforeEach(() => {
  vi.useFakeTimers();
  realtime.disconnect();
});

afterEach(() => {
  realtime.disconnect();
  vi.useRealTimers();
});

describe('store reactivity', () => {
  it('keeps the offline latch out of the dependencies of the effect that calls connect', () => {
    let runs = 0;
    const dispose = $effect.root(() => {
      $effect(() => {
        runs++;
        realtime.connect();
      });
    });
    flushSync();
    expect(runs).toBe(1);

    vi.advanceTimersByTime(3000);
    flushSync();
    expect(realtime.interrupted).toBe(true);
    expect(runs).toBe(1);

    realtime.disconnect();
    flushSync();
    expect(realtime.interrupted).toBe(false);
    expect(runs).toBe(1);

    dispose();
  });
});
