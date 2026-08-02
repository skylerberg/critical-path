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
