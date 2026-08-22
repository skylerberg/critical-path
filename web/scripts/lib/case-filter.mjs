/**
 * Choosing which cases a check script runs, by substring on the case's own name.
 *
 *   node scripts/check-board-layout-real.mjs --only=scroll
 *   node scripts/check-board-layout-real.mjs --only=scroll/740 --selftest
 *   node scripts/check-board-layout-real.mjs --list
 *
 * The name a case PRINTS is the key it is selected by, so a failing line can be
 * pasted straight back as `--only=<that line>`. There is no separate registry of
 * what exists either: the filter learns the namespace from the names it is asked
 * about, which is what lets `--list` and the matched-nothing error enumerate the
 * cases without a second list to drift out of step with the first.
 *
 * A filter narrows what a gate covers, so every way of getting one wrong has to
 * be loud. All three of these have a silent version that reads as a pass:
 *
 * - A pattern matching nothing exits non-zero listing what there was, rather
 *   than running zero cases and reporting success over them.
 * - A filtered run never prints the same summary an unfiltered one does, so a
 *   green line from `--only=scroll` cannot be mistaken for the whole gate.
 * - Under CI a filter is refused outright. Nothing should be able to narrow the
 *   gate by editing a workflow file; if the checks are ever sharded across jobs,
 *   relax this deliberately and make the shards account for every case.
 */

const PREFIX = '--only=';

export function caseFilter(argv, { env = process.env } = {}) {
  const patterns = argv
    .filter((arg) => arg.startsWith(PREFIX))
    .flatMap((arg) => arg.slice(PREFIX.length).split(','))
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean);
  const listing = argv.includes('--list');

  if (patterns.length > 0 && env.CI) {
    console.error(`--only= narrows what this gate covers, and is refused under CI.`);
    process.exit(2);
  }

  // Sets, not counters: a selftest re-runs the same case names as the phase it
  // is proving, and those are the same cases, not twice as many.
  const seen = new Set();
  const matched = new Set();
  const wanted = (name) => patterns.some((pattern) => name.toLowerCase().includes(pattern));

  return {
    /** Should this case run? Recording the name here is what builds the namespace. */
    wants(name) {
      seen.add(name);
      if (listing) {
        return false;
      }
      if (patterns.length === 0 || wanted(name)) {
        matched.add(name);
        return true;
      }
      return false;
    },

    /**
     * Would any of these run? For work that is expensive to set up before the
     * first case is reached — a second vite server for a selftest regression —
     * so it can be skipped whole. Deliberately does not record: these names are
     * recorded by `wants` when the cases themselves are reached.
     */
    wantsAny(names) {
      if (listing) {
        return false;
      }
      return patterns.length === 0 || names.some(wanted);
    },

    /**
     * Call once, after every phase has been offered its cases and before the
     * script decides its exit code. Handles `--list` and the matched-nothing
     * error, both of which end the process.
     */
    finish(label) {
      if (listing) {
        console.log(`${label} — cases:`);
        for (const name of seen) {
          console.log(`  ${name}`);
        }
        process.exit(0);
      }
      if (patterns.length > 0 && matched.size === 0) {
        console.error(`\n${label} — --only=${patterns.join(',')} matched none of:`);
        for (const name of seen) {
          console.error(`  ${name}`);
        }
        process.exit(2);
      }
    },

    /** The success word, plus what was left out — never the bare word when filtered. */
    summary(word) {
      if (patterns.length === 0) {
        return word;
      }
      const skipped = seen.size - matched.size;
      return `${word} (${matched.size} of ${seen.size} cases; ${skipped} skipped by --only=${patterns.join(',')})`;
    },
  };
}
