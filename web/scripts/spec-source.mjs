// Locating and freshness-checking a generated document from the api package.
// Shared by both generators, which differ only in which document they read and
// what they emit from it.

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The api package, by fixed relative path: this directory is two levels under
// the repository root and api is this package's sibling there. Nothing is
// searched for and nothing is overridable, because one commit now holds both
// sides of every schema change — the document that describes the api sources in
// this working tree is the only one this app should ever be generated from.
const API_DIR = resolve(__dirname, '..', '..', 'api');

// What generated output is labeled with. Repo-relative and constant, so a
// committed header records which package answered rather than one machine's
// path — and so a header naming a URL instead is visible at a glance.
const API_LABEL = 'api';

// The deployed API, not a dev server: a dev server is whatever build someone last
// started and nothing here can tell how old it is, which is exactly how a client
// drifts releases behind without anyone noticing.
const API_ORIGIN = process.env.API_ORIGIN || 'https://criticalpath.skylerberg.com';

// Reading the deployed API is for generating a client outside this repository,
// which is impossible-by-construction for the app that lives in it. So it is
// opt-in and never a fallback: unreachable sources fail the run instead. It was
// the automatic last resort once, and a lookup that stopped resolving therefore
// regenerated this app's client from production — one header line, in a file
// thousands of lines long, was the only tell.
const ALLOW_REMOTE = process.env.ALLOW_REMOTE_SPEC === '1';

// Which package script in the api package produces each document.
const DUMP_SCRIPTS = {
  'openapi.json': 'openapi:dump',
  'realtime-events.json': 'realtime:dump',
};

// Re-dumping beats deciding whether the dump is stale. Both dumps are pure
// functions of the api package's source — no database, under two seconds — so
// producing one on the spot is cheaper than being wrong about it, and it is the
// only answer that cannot be a false alarm in either direction.
//
// Best-effort: a checkout without node_modules cannot run it, and that is not a
// reason to fail. The freshness check still runs on whatever dump is already
// there.
function redump(apiRoot, filename) {
  const script = DUMP_SCRIPTS[filename];
  if (script === undefined) return false;
  try {
    execFileSync('pnpm', ['run', script], {
      cwd: apiRoot,
      stdio: 'pipe',
      timeout: 120_000,
    });
    return true;
  } catch {
    return false;
  }
}

// Absolute, and printed on every local read: which document answered is the one
// thing the output never used to say, and a run that read the wrong one looks
// exactly like a run that worked.
function announce(dumpPath, redumped) {
  console.log(`${redumped ? 'Re-dumped' : 'Reading existing'} ${dumpPath}`);
}

// A stale document silently drops whole endpoints from the client, and the result
// only fails under svelte-check — never under vitest, which strips types.
//
// `redumped` says the file was just produced from the sources in this working
// tree, which settles the question exactly; the mtime comparison below is only
// for when that was not possible. It reads the dump's mtime against the newest
// file that determines it. Comparing against the HEAD commit date instead calls a
// good dump stale after any merge or pull, since HEAD moves whether or not
// anything under the api package's src did — and even against the sources it is
// only a proxy, because reverting a file rewrites it without changing what it
// says.
async function assertIsFresh(path, { redumped }) {
  if (redumped) return;
  const apiRoot = dirname(path);

  let sources;
  try {
    sources = execFileSync('git', ['-C', apiRoot, 'ls-files', 'src'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
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
        `Dump it in the api package first, or the generated output will be missing things.`
    );
  }
}

function missingApiPackage(filename) {
  return new Error(
    `No api package at ${API_DIR}, so ${filename} cannot be produced from this checkout.\n` +
      `It is a fixed path within this repository and is expected to exist; a missing one ` +
      `means the checkout is incomplete.\n` +
      `To generate against the deployed API on purpose — which describes a release, not ` +
      `this working tree — set ALLOW_REMOTE_SPEC=1 (optionally with API_ORIGIN).`
  );
}

async function fetchDocument(target) {
  const res = await fetch(target);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${target}: HTTP ${res.status}`);
  }
  return { doc: await res.json(), source: target };
}

/**
 * Load a document from the api package in this repository. An explicit path or
 * URL overrides that; the deployed API is reached only when asked for, never as
 * a fallback.
 */
export async function loadDocument({ filename, urlPath, path, url }) {
  // Labeled by repo-relative name rather than the path it was read from, so the
  // header of a committed generated file does not record one machine's checkout.
  const label = `${API_LABEL}/${filename}`;
  if (path) {
    const redumped = redump(dirname(path), filename);
    announce(path, redumped);
    await assertIsFresh(path, { redumped });
    return { doc: JSON.parse(await readFile(path, 'utf8')), source: label };
  }
  if (url) return fetchDocument(url);
  if (!existsSync(API_DIR)) {
    if (ALLOW_REMOTE) return fetchDocument(`${API_ORIGIN}${urlPath}`);
    throw missingApiPackage(filename);
  }
  const dumped = resolve(API_DIR, filename);
  const redumped = redump(API_DIR, filename);
  if (!redumped && !existsSync(dumped)) {
    throw new Error(
      `${dumped} does not exist and \`pnpm run ${DUMP_SCRIPTS[filename]}\` in ${API_DIR} failed.\n` +
        `Install the api package's dependencies, then retry — the dump needs no .env, ` +
        `no database and no running server.`
    );
  }
  announce(dumped, redumped);
  await assertIsFresh(dumped, { redumped });
  return { doc: JSON.parse(await readFile(dumped, 'utf8')), source: label };
}
