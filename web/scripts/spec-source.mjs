// Locating and freshness-checking a generated document from the API repo. Shared
// by both generators, which differ only in which document they read and what
// they emit from it.

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const API_REPO_DIR = process.env.API_REPO_DIR || 'critical-path-api';
const __dirname = dirname(fileURLToPath(import.meta.url));

// The deployed API, not a dev server: a dev server is whatever build someone last
// started and nothing here can tell how old it is, which is exactly how a client
// drifts releases behind without anyone noticing.
export const API_ORIGIN = process.env.API_ORIGIN || 'https://criticalpath.skylerberg.com';

// The API repo is a sibling of the *main* checkout, which a worktree outside the
// repository cannot reach by walking up. Ask git where the main checkout is and
// look beside that too, so a worktree anywhere on disk still finds the document
// rather than silently falling back to the network.
function mainCheckout() {
  try {
    const gitDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: __dirname, encoding: 'utf8' }
    ).trim();
    return gitDir === '' ? null : dirname(gitDir);
  } catch {
    return null;
  }
}

function findDumped(filename) {
  const roots = [];
  for (let dir = __dirname; ; ) {
    roots.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const main = mainCheckout();
  if (main !== null) roots.push(main, dirname(main));
  for (const dir of roots) {
    const candidate = resolve(dir, API_REPO_DIR, filename);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// A stale spec silently drops whole endpoints from the client, and the result
// only fails under svelte-check — never under vitest, which strips types.
//
// Both documents are gitignored in the api repo — local dumps, never committed — so
// freshness is
// its mtime against the newest file that determines it. Comparing against the
// HEAD commit date instead calls a good dump stale after any merge or pull, since
// HEAD moves whether or not anything under src/ did.
async function assertIsFresh(path) {
  const apiRoot = dirname(path);
  const git = (args) => execFileSync('git', ['-C', apiRoot, ...args], { encoding: 'utf8' }).trim();

  let sources;
  try {
    sources = git(['ls-files', 'src']).split('\n').filter(Boolean);
  } catch {
    return;
  }

  const { mtime } = await stat(path);
  let newest = null;
  for (const relative of sources) {
    const stats = await stat(resolve(apiRoot, relative)).catch(() => null);
    if (stats !== null && (newest === null || stats.mtime > newest.mtime)) {
      newest = { mtime: stats.mtime, relative };
    }
  }
  if (newest !== null && mtime < newest.mtime) {
    throw new Error(
      `${path} was written ${mtime.toISOString()}, older than ${newest.relative} ` +
        `(${newest.mtime.toISOString()}).\n` +
        `Re-dump it in the api repo first, or the generated output will be missing things.`
    );
  }

  // A dump only ever reflects the checkout, so fetching without pulling produces a
  // spec that is newer than HEAD and still missing everything merged upstream.
  let behind;
  try {
    behind = git(['rev-list', '--count', 'HEAD..origin/main']);
  } catch {
    return;
  }
  if (behind !== '0') {
    throw new Error(
      `${apiRoot} is ${behind} commit(s) behind origin/main, so ${path} cannot describe them.\n` +
        `Run \`git pull\` there, then re-dump, then regenerate.`
    );
  }
}

/**
 * Load a document by explicit path, then a sibling checkout's dump, then the
 * deployed API. Only the dump can be freshness-checked, so it wins over the
 * network whenever one is present.
 */
export async function loadDocument({ filename, urlPath, path, url }) {
  // Labelled by repo-relative name rather than the path it was read from, so the
  // header of a committed generated file does not record one machine's checkout.
  const label = `${API_REPO_DIR}/${filename}`;
  if (path) {
    await assertIsFresh(path);
    return { doc: JSON.parse(await readFile(path, 'utf8')), source: label };
  }
  if (!url) {
    const dumped = findDumped(filename);
    if (dumped) {
      await assertIsFresh(dumped);
      return { doc: JSON.parse(await readFile(dumped, 'utf8')), source: label };
    }
  }
  const target = url || `${API_ORIGIN}${urlPath}`;
  const res = await fetch(target);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${target}: HTTP ${res.status}`);
  }
  return { doc: await res.json(), source: target };
}
