import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionPreference } from './motion.svelte';

type Listener = (event: MediaQueryListEvent) => void;

function stubMatchMedia(matches: boolean) {
  const added: { type: string; listener: Listener }[] = [];
  const removed: { type: string; listener: Listener }[] = [];
  const queries: string[] = [];
  const matchMedia = vi.fn((query: string) => {
    queries.push(query);
    return {
      matches,
      addEventListener: (type: string, listener: Listener) => added.push({ type, listener }),
      removeEventListener: (type: string, listener: Listener) => removed.push({ type, listener }),
    } as unknown as MediaQueryList;
  });
  vi.stubGlobal('matchMedia', matchMedia);
  return { added, removed, queries };
}

const instances: MotionPreference[] = [];

function start(matches: boolean) {
  const stub = stubMatchMedia(matches);
  const instance = new MotionPreference();
  instance.init();
  instances.push(instance);
  return { instance, ...stub };
}

afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.dispose();
  }
  vi.unstubAllGlobals();
});

describe('MotionPreference', () => {
  it('seeds reduced from a matching query', () => {
    const { instance, queries } = start(true);

    expect(queries).toEqual(['(prefers-reduced-motion: reduce)']);
    expect(instance.reduced).toBe(true);
  });

  it('seeds reduced to false when the query does not match', () => {
    const { instance } = start(false);

    expect(instance.reduced).toBe(false);
  });

  it('tracks later changes to the preference', () => {
    const { instance, added } = start(false);

    const listener = added[0]?.listener;
    expect(added[0]?.type).toBe('change');
    expect(listener).toBeDefined();

    listener!({ matches: true } as MediaQueryListEvent);
    expect(instance.reduced).toBe(true);

    listener!({ matches: false } as MediaQueryListEvent);
    expect(instance.reduced).toBe(false);
  });

  it('removes the exact listener it registered and tolerates a second dispose', () => {
    const { instance, added, removed } = start(true);

    instance.dispose();

    expect(removed).toHaveLength(1);
    expect(removed[0]?.type).toBe('change');
    expect(removed[0]?.listener).toBe(added[0]?.listener);

    instance.dispose();
    expect(removed).toHaveLength(1);
  });

  it('stays false and does not throw where matchMedia is unavailable', () => {
    expect(window.matchMedia).toBeUndefined();
    const instance = new MotionPreference();
    instances.push(instance);

    expect(() => instance.init()).not.toThrow();
    expect(instance.reduced).toBe(false);
  });
});
