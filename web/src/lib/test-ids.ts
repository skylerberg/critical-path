import { BASE_62_DIGITS, generateNKeysBetween } from 'fractional-indexing';

/**
 * Sort keys for fixtures, in ascending order.
 *
 * Hand-written keys are a trap: `ranks.ts` passes `BASE_62_DIGITS`, under which
 * the library generates `V0`, `V1`, `V2` … and rejects most other strings as
 * *input* — `'W0'` and `'a0'` both throw, and `'a0'` looks safe only because it
 * is what the library's *default* digit set produces. The throw comes from
 * inside `fractional-indexing` as an unhandled rejection labelled with whichever
 * test happened to be running, which is rarely the one holding the bad key.
 *
 * Asking the library removes the guesswork, and keeps a fixture valid if the
 * digit set ever changes.
 */
export function testSortKeys(count: number): string[] {
  return generateNKeysBetween(null, null, count, BASE_62_DIGITS);
}

/** The `index`-th key of an ascending run. `testSortKey(0) < testSortKey(1)`. */
export function testSortKey(index: number): string {
  return testSortKeys(index + 1)[index]!;
}

// Fixtures name ids 'p1' or 't9' for legibility, but ids now reach the URL through
// an encoder that rejects anything that is not a uuid. Deriving one from the seed
// keeps the fixture readable and stable across runs.
export function testUuid(seed: string): string {
  const bytes: number[] = [];
  for (let block = 0; bytes.length < 16; block++) {
    let hash = 0x811c9dc5;
    for (const char of `${seed}#${String(block)}`) {
      hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
    }
    bytes.push((hash >>> 24) & 255, (hash >>> 16) & 255, (hash >>> 8) & 255, hash & 255);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
