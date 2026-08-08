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

function findApiRoot() {
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
    const candidate = resolve(dir, API_REPO_DIR);
    if (existsSync(resolve(candidate, 'package.json'))) return candidate;
  }
  return null;
}

// Which npm script in the api repo produces each document.
const DUMP_SCRIPTS = {
  'openapi.json': 'openapi:dump',
  'realtime-events.json': 'realtime:dump',
};

// Re-dumping beats deciding whether the dump is stale. Both dumps are pure
// functions of the api repo's source — no database, under two seconds — so
// producing one on the spot is cheaper than being wrong about it, and it is the
// only answer that cannot be a false alarm in either direction.
//
// Best-effort: a checkout without node_modules or without .env cannot run it,
// and that is not a reason to fail. The freshness check still runs on whatever
// dump is already there.
function redump(apiRoot, filename) {
  const script = DUMP_SCRIPTS[filename];
  if (script === undefined) return false;
  try {
    execFileSync('npm', ['run', script], {
      cwd: apiRoot,
      stdio: 'pipe',
      timeout: 120_000,
    });
    // Writing into a sibling checkout is a side effect worth naming, even though
    // the file is gitignored there.
    console.log(`Re-dumped ${API_REPO_DIR}/${filename}`);
    return true;
  } catch {
    return false;
  }
}

// A stale document silently drops whole endpoints from the client, and the result
// only fails under svelte-check — never under vitest, which strips types.
//
// `redumped` says the file was just produced from this checkout, which settles
// the question exactly; the mtime comparison below is only for when that was not
// possible. It reads the dump's mtime against the newest file that determines it.
// Comparing against the HEAD commit date instead calls a good dump stale after
// any merge or pull, since HEAD moves whether or not anything under src/ did —
// and even against the sources it is only a proxy, because reverting a file
// rewrites it without changing what it says.
async function assertIsFresh(path, { redumped }) {
  const apiRoot = dirname(path);
  const git = (args) => execFileSync('git', ['-C', apiRoot, ...args], { encoding: 'utf8' }).trim();

  if (!redumped) {
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
          `(${newest.mtime.toISOString()}), and it could not be re-dumped automatically.\n` +
          `Re-dump it in the api repo first, or the generated output will be missing things.`
      );
    }
  }

  // Survives a re-dump: dumping a checkout that is behind produces a confidently
  // wrong document rather than a stale one, which is worse.
  let behind;
  try {
    behind = git(['rev-list', '--count', 'HEAD..origin/main']);
  } catch {
    return;
  }
  if (behind !== '0') {
    throw new Error(
      `${apiRoot} is ${behind} commit(s) behind origin/main, so ${path} cannot describe them.\n` +
        `Run \`git pull\` there, then regenerate.`
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
    await assertIsFresh(path, { redumped: redump(dirname(path), filename) });
    return { doc: JSON.parse(await readFile(path, 'utf8')), source: label };
  }
  if (!url) {
    const apiRoot = findApiRoot();
    if (apiRoot !== null) {
      const dumped = resolve(apiRoot, filename);
      const redumped = redump(apiRoot, filename);
      // A repo that has never been dumped and could not be dumped now has
      // nothing to read, so fall through to the network rather than failing.
      if (redumped || existsSync(dumped)) {
        await assertIsFresh(dumped, { redumped });
        return { doc: JSON.parse(await readFile(dumped, 'utf8')), source: label };
      }
    }
  }
  const target = url || `${API_ORIGIN}${urlPath}`;
  const res = await fetch(target);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${target}: HTTP ${res.status}`);
  }
  return { doc: await res.json(), source: target };
}
