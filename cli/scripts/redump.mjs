// Re-dumping beats deciding whether a dump is stale. Both dumps are pure
// functions of this repo's source — no database, under two seconds — so
// producing one on the spot is cheaper than reasoning about the old one's age,
// and it is the only answer that cannot be wrong in either direction. The CLI's
// generators previously read whatever dump happened to be lying in the repo
// root, with nothing checking how old it was.
//
// Best-effort: an explicit SPEC_URL/SPEC_PATH means the caller has said where to
// read from, and a dump that fails for any reason leaves whatever is already
// there. Neither is a reason to refuse to generate.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function redump(script) {
  try {
    execFileSync('npm', ['run', script], { cwd: API_ROOT, stdio: 'pipe', timeout: 120_000 });
    return true;
  } catch {
    return false;
  }
}
