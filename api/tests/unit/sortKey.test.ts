import { describe, it, expect } from 'vitest';
import { generateKeyBetween, BASE_62_DIGITS } from 'fractional-indexing';
import {
  SORT_KEY_MAX_LENGTH,
  isValidSortKey,
  keyBetween,
  keysBetween,
} from '../../src/services/sortKey';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertUsableAsBound(key: string): void {
  expect(isValidSortKey(key)).toBe(true);
  expect(() => generateKeyBetween(key, null, BASE_62_DIGITS)).not.toThrow();
  expect(() => generateKeyBetween(null, key, BASE_62_DIGITS)).not.toThrow();
}

function assertStrictlySorted(keys: readonly string[]): void {
  for (let i = 1; i < keys.length; i++) {
    if (!(keys[i - 1]! < keys[i]!)) {
      throw new Error(`not strictly sorted at ${i}: ${keys[i - 1]} !< ${keys[i]}`);
    }
  }
}

describe('sort key invariants', () => {
  it('generates a usable key from empty bounds', () => {
    assertUsableAsBound(keyBetween(null, null));
  });

  it('stays strictly between its bounds under randomized insertion', () => {
    const random = seeded(0x5eed);
    let keys = [keyBetween(null, null)];

    for (let step = 0; step < 20_000; step++) {
      const index = Math.floor(random() * (keys.length + 1));
      const before = index === 0 ? null : keys[index - 1]!;
      const after = index === keys.length ? null : keys[index]!;
      const key = keyBetween(before, after);

      if (before !== null) expect(before < key).toBe(true);
      if (after !== null) expect(key < after).toBe(true);
      assertUsableAsBound(key);

      keys = [...keys.slice(0, index), key, ...keys.slice(index)];
    }

    assertStrictlySorted(keys);
  });

  it('survives repeated insertion against the same neighbour', () => {
    const outer = keysBetween(null, null, 2);
    let low = outer[0]!;
    const high = outer[1]!;
    const inserted: string[] = [];

    for (let step = 0; step < 4_000; step++) {
      const key = keyBetween(low, high);
      expect(low < key).toBe(true);
      expect(key < high).toBe(true);
      expect(key.length).toBeLessThanOrEqual(SORT_KEY_MAX_LENGTH);
      inserted.push(key);
      low = key;
    }

    assertStrictlySorted(inserted);
    assertUsableAsBound(inserted[inserted.length - 1]!);
  });

  // Keys are a shared contract across three packages, so the exact strings the
  // generator produces are pinned rather than merely well-ordered.
  it('produces the same keys for the same bounds', () => {
    expect(keysBetween(null, null, 3)).toEqual(['V0', 'V1', 'V2']);
    expect(keyBetween('V0', 'V1')).toBe('V0V');
    expect(keyBetween('V0', null)).toBe('V1');
    expect(keyBetween(null, 'V0')).toBe('Uz');
  });

  it('keeps bulk keys sorted and inside their bounds', () => {
    const [low, high] = keysBetween(null, null, 2) as [string, string];

    for (const count of [1, 2, 7, 64, 500]) {
      const keys = keysBetween(low, high, count);
      expect(keys).toHaveLength(count);
      assertStrictlySorted(keys);
      expect(low < keys[0]!).toBe(true);
      expect(keys[keys.length - 1]! < high).toBe(true);
      for (const key of keys) assertUsableAsBound(key);
    }

    expect(keysBetween(null, null, 0)).toEqual([]);
  });

  // Repeatedly inserting against the same neighbour costs a fixed amount of key
  // per insert -- unavoidable, since distinguishing n insertions at one spot
  // needs n bits somewhere. This pins the rate so a regression in the alphabet
  // or the generator shows up as a change in insertion budget.
  it('grows about a character per five same-neighbour inserts', () => {
    const [low, high] = keysBetween(null, null, 2) as [string, string];
    const steps = 2_000;
    let current = low;
    for (let step = 0; step < steps; step++) {
      current = keyBetween(current, high);
    }

    const perInsert = current.length / steps;
    expect(perInsert).toBeGreaterThan(0.15);
    expect(perInsert).toBeLessThan(0.25);
    expect(SORT_KEY_MAX_LENGTH / perInsert).toBeGreaterThan(4_000);
  });

  it('stays short when inserts are spread across slots', () => {
    const random = seeded(0xfade);
    let keys = keysBetween(null, null, 2);

    for (let step = 0; step < 20_000; step++) {
      const index = 1 + Math.floor(random() * (keys.length - 1));
      const key = keyBetween(keys[index - 1]!, keys[index]!);
      keys = [...keys.slice(0, index), key, ...keys.slice(index)];
    }

    expect(Math.max(...keys.map((key) => key.length))).toBeLessThan(20);
  });
});

describe('sort key validation', () => {
  it('accepts keys the generator produces', () => {
    expect(isValidSortKey(keyBetween(null, null))).toBe(true);
    for (const key of keysBetween(null, null, 50)) {
      expect(isValidSortKey(key)).toBe(true);
    }
  });

  it('rejects malformed keys', () => {
    expect(isValidSortKey('')).toBe(false);
    expect(isValidSortKey('a0!')).toBe(false);
    expect(isValidSortKey('a 0')).toBe(false);
    expect(isValidSortKey('héllo')).toBe(false);
    expect(isValidSortKey('!!!')).toBe(false);
  });

  it('rejects keys with a trailing zero digit', () => {
    const key = keyBetween(null, null);
    expect(isValidSortKey(`${key}0`)).toBe(false);
  });

  it('rejects keys longer than the cap', () => {
    expect(isValidSortKey('a'.repeat(SORT_KEY_MAX_LENGTH + 1))).toBe(false);
  });
});
