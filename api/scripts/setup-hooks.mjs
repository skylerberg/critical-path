import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Point git at the monorepo-root .githooks, which dispatches per package.
//
// Three things about this are load-bearing:
//
//   1. `git rev-parse`, not existsSync('.git'). This runs with cwd set to the
//      package directory, where there is no .git to see at all, so the old check
//      was false in every package and the postinstall silently installed nothing.
//      A worktree has no .git directory either — it is a file pointing elsewhere.
//   2. core.hooksPath is one repository-global key. Every package that runs this
//      writes the same value, because there is only one slot to write.
//   3. Relative on purpose. git resolves a relative hooksPath against the top of
//      the working tree, so a worktree gets its own checkout's hooks rather than
//      whichever checkout last ran an install.
const HOOKS_PATH = '.githooks';

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

let top;
try {
  top = git(['rev-parse', '--show-toplevel']);
} catch {
  // Not a checkout: CI installs from a tarball and the Dockerfile copies source
  // without .git. Nothing to wire up, and failing here would fail the install.
  process.exit(0);
}

if (!top || !existsSync(join(top, HOOKS_PATH))) {
  process.exit(0);
}

let current = '';
try {
  current = git(['config', '--get', 'core.hooksPath']);
} catch {
  // Unset; `git config --get` exits 1 for a missing key.
}

if (current !== HOOKS_PATH) {
  execFileSync('git', ['config', 'core.hooksPath', HOOKS_PATH], { stdio: 'inherit' });
}
