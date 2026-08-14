// fzf-style subsequence matching: every query character has to appear in the
// text, in order, with gaps allowed. Deliberately no edit distance — a
// transposition is a miss rather than a low score, because a matcher that
// accepts "lables" also accepts most of the palette on any three-letter query.

const SEPARATOR_RE = /[\s\-_/.·,:([]/;

// Only the order of two scores for the *same* query is ever read, so there is no
// per-character constant here: it would add the same amount to every candidate.
const RUN = 8;
const BOUNDARY = 8;
const GAP = 1;
// A name whose match starts late is worth less, but not without bound: where a
// word sits in a long name says much less than how scattered the match is.
const LEADING_GAP_MAX = 12;

// `String.prototype.toLowerCase` is not length-preserving — 'İ' (U+0130) folds to
// two code units — and the scan below indexes the folded text and the original
// with the same j, reading the case off the original. Folding one character at a
// time and keeping the original's width is what keeps those two indexes the same
// index; whole-string folding walks `isBoundary` off the end of `text`.
function foldCase(text: string): string {
  let out = '';
  for (const char of text) {
    const lower = char.toLowerCase();
    out += lower.length === char.length ? lower : lower.slice(0, char.length);
  }
  return out;
}

// Case comes from the original text: lowercasing first would erase the camel
// hump, which is the only boundary a separator does not already announce.
function isBoundary(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const before = text[index - 1];
  if (SEPARATOR_RE.test(before)) {
    return true;
  }
  const char = text[index];
  return before !== before.toUpperCase() && char !== char.toLowerCase();
}

// A greedy left-to-right scan would be cheaper and would rank wrong: it takes
// the first occurrence of each character and never sees a tighter alignment
// further along, so "ab" scores "a batch ab" on its scattered reading. The names
// this runs over are short and few, so the full search is free.
export function fuzzyScore(query: string, text: string): number | null {
  // Stripped from the query alone, so "proj a" reaches "Project Alpha".
  const q = foldCase(query.replace(/\s+/g, ''));
  if (q === '') {
    return 0;
  }
  const lower = foldCase(text);
  if (q.length > lower.length) {
    return null;
  }

  // best[j] = the best score for matching the query through q[i] with q[i]
  // placed at text[j]; -Infinity where that placement is impossible.
  let prev: number[] = [];
  for (let i = 0; i < q.length; i++) {
    const cur = new Array<number>(lower.length).fill(-Infinity);
    // max over k <= j-2 of prev[k] + GAP*k, which is prev[k] minus the gap
    // penalty with the j-dependent part factored out: reaching j from k costs
    // GAP*(j-k-1), so the best k to come from does not depend on j.
    let bestGapped = -Infinity;
    for (let j = 0; j < lower.length; j++) {
      if (i > 0 && j >= 2 && prev[j - 2] !== -Infinity) {
        bestGapped = Math.max(bestGapped, prev[j - 2] + GAP * (j - 2));
      }
      if (lower[j] !== q[i]) {
        continue;
      }
      const bonus = isBoundary(text, j) ? BOUNDARY : 0;
      if (i === 0) {
        cur[j] = bonus - Math.min(j, LEADING_GAP_MAX) * GAP;
        continue;
      }
      const contiguous = j >= 1 && prev[j - 1] !== -Infinity ? prev[j - 1] + RUN : -Infinity;
      const gapped = bestGapped === -Infinity ? -Infinity : bestGapped - GAP * (j - 1);
      const from = Math.max(contiguous, gapped);
      if (from !== -Infinity) {
        cur[j] = from + bonus;
      }
    }
    prev = cur;
  }

  const best = prev.reduce((a, b) => Math.max(a, b), -Infinity);
  return best === -Infinity ? null : best;
}
