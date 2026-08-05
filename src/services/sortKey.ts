import { generateKeyBetween, generateNKeysBetween, BASE_62_DIGITS } from 'fractional-indexing';

// Inserting repeatedly against the same neighbour lengthens each successive key
// by ~0.2 characters, so the cap is what bounds insertions at a single spot
// (~5000). Reaching it is a clean rejection, never a silent reordering, and it
// stays clear of both Postgres' btree entry limit and the recursion depth in
// the library's midpoint().
export const SORT_KEY_MAX_LENGTH = 1024;

export function keyBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b, BASE_62_DIGITS);
}

export function keysBetween(a: string | null, b: string | null, count: number): string[] {
  return generateNKeysBetween(a, b, count, BASE_62_DIGITS);
}

export function isValidSortKey(key: string): boolean {
  if (key.length === 0 || key.length > SORT_KEY_MAX_LENGTH) {
    return false;
  }
  for (const character of key) {
    if (!BASE_62_DIGITS.includes(character)) {
      return false;
    }
  }
  return structurallyValid(key);
}

// The library validates a key whenever it is used as a bound. Either direction
// proves the structure; one alone would also reject the largest and smallest
// representable integers, which are structurally fine but have no room beyond.
function structurallyValid(key: string): boolean {
  for (const bounds of [[key, null] as const, [null, key] as const]) {
    try {
      generateKeyBetween(bounds[0], bounds[1], BASE_62_DIGITS);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}
