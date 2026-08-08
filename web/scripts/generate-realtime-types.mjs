#!/usr/bin/env node
// Event types for the /ws envelope, generated from the API's realtime-events.json.
//
// Kept separate from generate-api-types.mjs because the two artefacts differ in
// kind: openapi.json is gitignored in the API repo and dumped locally, so it is
// checked against that repo's HEAD to catch a forgotten dump. realtime-events.json
// is committed, so a checkout always matches its commit and the mtime tells us
// nothing — git sets it at checkout time, which is routinely older than HEAD for
// a file no recent commit touched. What can still be wrong is the checkout
// itself, so that is what this checks.
//
// Nothing is filtered either: the document declares no paths, so every schema in
// it is part of the envelope union rather than something a path reaches.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

const API_REPO_DIR = process.env.API_REPO_DIR || 'critical-path-api';
const DOC_PATH = process.env.REALTIME_DOC_PATH;
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '..', 'src', 'api', 'realtime.generated.ts');

// The API repo is a sibling of the *main* checkout, which a worktree outside the
// repository cannot reach by walking up.
function mainCheckout() {
  try {
    const gitDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: __dirname,
        encoding: 'utf8',
      }
    ).trim();
    return gitDir === '' ? null : dirname(gitDir);
  } catch {
    return null;
  }
}

function findDocument() {
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
    const candidate = resolve(dir, API_REPO_DIR, 'realtime-events.json');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function assertCheckoutIsCurrent(docPath) {
  const apiRoot = dirname(docPath);
  const git = (args) => execFileSync('git', ['-C', apiRoot, ...args], { encoding: 'utf8' }).trim();
  let behind;
  try {
    behind = git(['rev-list', '--count', 'HEAD..origin/main']);
  } catch {
    return;
  }
  if (behind !== '0') {
    throw new Error(
      `${apiRoot} is ${behind} commit(s) behind origin/main, so ${docPath} cannot describe them.\n` +
        `Run \`git pull\` there, then regenerate.`
    );
  }
}

const docPath = DOC_PATH ?? findDocument();
if (docPath === null) {
  throw new Error(
    `Could not find ${API_REPO_DIR}/realtime-events.json beside this checkout.\n` +
      `Set REALTIME_DOC_PATH, or API_REPO_DIR if the api repo is named differently.`
  );
}
assertCheckoutIsCurrent(docPath);

const doc = JSON.parse(await readFile(docPath, 'utf8'));
const header =
  `// AUTO-GENERATED FROM ${API_REPO_DIR}/realtime-events.json\n` +
  `// DO NOT EDIT. Regenerate with: npm run generate:realtime\n`;
await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, header + '\n' + astToString(await openapiTS(doc)), 'utf8');
console.log(`Wrote ${OUTPUT_PATH}`);
