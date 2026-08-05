#!/usr/bin/env node
// Deprecated operations/schemas — and schemas only they referenced — are
// filtered before codegen so stale call sites turn into TypeScript errors.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

const API_REPO_DIR = process.env.API_REPO_DIR || 'critical-path-api';
const SPEC_URL = process.env.SPEC_URL;
const SPEC_PATH = process.env.SPEC_PATH;
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '..', 'src', 'api', 'api.generated.ts');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

// The API repo is a sibling of the *main* checkout, which a worktree outside the
// repository cannot reach by walking up. Ask git where the main checkout is and
// look beside that too, so a worktree anywhere on disk still finds the spec
// rather than silently falling back to whatever is serving on SPEC_URL.
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

function findDumpedSpec() {
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
    const candidate = resolve(dir, API_REPO_DIR, 'openapi.json');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// A stale spec silently drops whole endpoints from the client, and the result
// only fails under svelte-check — never under vitest, which strips types.
async function assertSpecIsFresh(specPath) {
  const { mtime } = await stat(specPath);
  const apiRoot = dirname(specPath);
  const git = (args) => execFileSync('git', ['-C', apiRoot, ...args], { encoding: 'utf8' }).trim();
  let head;
  try {
    head = git(['log', '-1', '--format=%cI']);
  } catch {
    return;
  }
  if (mtime < new Date(head)) {
    throw new Error(
      `${specPath} was written ${mtime.toISOString()}, older than that repo's HEAD commit (${head}).\n` +
        `Run \`npm run openapi:dump\` in the api repo first, or the generated client will be missing endpoints.`
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
      `${apiRoot} is ${behind} commit(s) behind origin/main, so ${specPath} cannot describe them.\n` +
        `Run \`git pull\` there, then \`npm run openapi:dump\`, then regenerate.`
    );
  }
}

async function loadSpec() {
  if (SPEC_PATH) {
    await assertSpecIsFresh(SPEC_PATH);
    return { spec: JSON.parse(await readFile(SPEC_PATH, 'utf8')), source: SPEC_PATH };
  }
  // The dev server is whatever build someone last started, and nothing here can tell
  // how old it is. The dumped file can be freshness-checked, so it wins by default.
  if (!SPEC_URL) {
    const dumped = findDumpedSpec();
    if (dumped) {
      await assertSpecIsFresh(dumped);
      return { spec: JSON.parse(await readFile(dumped, 'utf8')), source: dumped };
    }
  }
  const url = SPEC_URL || 'http://localhost:3001/api/openapi.json';
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return { spec: await res.json(), source: url };
}

function filterDeprecated(spec) {
  let removedOps = 0;
  let removedSchemas = 0;

  if (spec.paths && typeof spec.paths === 'object') {
    for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;
      for (const method of Object.keys(pathItem)) {
        if (!HTTP_METHODS.has(method.toLowerCase())) continue;
        const op = pathItem[method];
        if (op && typeof op === 'object' && op.deprecated === true) {
          delete pathItem[method];
          removedOps++;
        }
      }
      const remaining = Object.keys(pathItem).filter((k) => HTTP_METHODS.has(k.toLowerCase()));
      if (remaining.length === 0) {
        delete spec.paths[pathKey];
      }
    }
  }

  if (spec.components?.schemas && typeof spec.components.schemas === 'object') {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      if (schema && typeof schema === 'object' && schema.deprecated === true) {
        delete spec.components.schemas[name];
        removedSchemas++;
      }
    }
    removedSchemas += pruneUnreachableSchemas(spec);
  }

  return { removedOps, removedSchemas };
}

function collectSchemaRefs(node, refs) {
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaRefs(item, refs);
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (typeof node.$ref === 'string') {
    const match = /^#\/components\/schemas\/(.+)$/.exec(node.$ref);
    if (match) refs.add(match[1]);
  }
  for (const value of Object.values(node)) collectSchemaRefs(value, refs);
}

function pruneUnreachableSchemas(spec) {
  const schemas = spec.components.schemas;
  const reachable = new Set();
  const { components, ...rest } = spec;
  collectSchemaRefs(rest, reachable);
  for (const [name, value] of Object.entries(components)) {
    if (name !== 'schemas') collectSchemaRefs(value, reachable);
  }
  const queue = [...reachable];
  while (queue.length > 0) {
    const name = queue.pop();
    if (!(name in schemas)) continue;
    const nested = new Set();
    collectSchemaRefs(schemas[name], nested);
    for (const ref of nested) {
      if (!reachable.has(ref)) {
        reachable.add(ref);
        queue.push(ref);
      }
    }
  }
  let removed = 0;
  for (const name of Object.keys(schemas)) {
    if (!reachable.has(name)) {
      delete schemas[name];
      removed++;
    }
  }
  return removed;
}

async function main() {
  const { spec, source } = await loadSpec();
  const { removedOps, removedSchemas } = filterDeprecated(spec);
  const ast = await openapiTS(spec);
  const header =
    `// AUTO-GENERATED FROM ${source}\n` +
    `// DO NOT EDIT. Regenerate with: npm run generate:api\n` +
    `// Deprecated operations and schemas are filtered out at generation time.\n`;
  const output = header + '\n' + astToString(ast);
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, output, 'utf8');
  console.log(
    `Wrote ${OUTPUT_PATH} (filtered ${removedOps} deprecated operations, ${removedSchemas} deprecated schemas)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
