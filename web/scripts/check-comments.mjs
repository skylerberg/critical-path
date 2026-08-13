#!/usr/bin/env node
// Two things comments here get wrong, both of which a reader takes on trust.
//
//   npm run check:comments
//
// 1. The same rationale copied into two files. Whichever copy is not next to the
//    code that changes is the one that goes stale, and nothing points the editor
//    of one at the other. Fix by giving the rule a single owner — the module that
//    implements it — and cutting the copy down to what is local to its own site.
// 2. A file or symbol named in a comment that no longer resolves, or that
//    resolves somewhere other than where the comment says it is.
//
// Neither is a style rule. Both were found live: a `#sendOrFail` doc that
// miscounted its own call sites, and a comment placing a test helper in the
// directory next door to the one it is actually in.
//
// `--selftest` re-runs both checks against text that is deliberately wrong and
// fails if either reports clean. Run it after changing what they assert: a
// checker that has stopped matching anything reports the same green as a clean
// tree.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, basename } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SELFTEST = process.argv.includes('--selftest');

const SCANNED = ['src', 'scripts'];
const EXTENSIONS = ['.ts', '.svelte', '.mjs'];
// Generated clients carry the API's own prose, which is duplicated across
// endpoints by design and is not ours to edit.
const SKIP = (path) => path.includes('.generated.') || path.includes('node_modules');

// A sentence shorter than this is a fragment ("Test seam.", "Best effort:") that
// two files can share without either being a copy of the other.
const MIN_SENTENCE = 55;

async function sourceFiles() {
  const found = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (SKIP(full)) continue;
      if (entry.isDirectory()) await walk(full);
      else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) found.push(full);
    }
  }
  for (const dir of SCANNED) await walk(join(ROOT, dir));
  found.push(join(ROOT, 'vite.config.ts'));
  return found;
}

// Consecutive comment lines are one block: a rule split over four lines is one
// claim, and splitting it per line would match the wrapping rather than the text.
export function commentBlocks(source) {
  const blocks = [];
  let current = null;
  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    const isComment = /^(\/\/|\/\*|\*|<!--)/.test(trimmed);
    if (!isComment) {
      current = null;
      return;
    }
    const text = trimmed
      .replace(/^(\/\/+|\/\*+|\*+\/?|<!--)/, '')
      .replace(/-->$/, '')
      .trim();
    if (current === null) {
      current = { line: index + 1, text };
      blocks.push(current);
    } else {
      current.text += ` ${text}`;
    }
  });
  return blocks;
}

export function sentences(text) {
  return text
    .split(/(?<=[.:;])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= MIN_SENTENCE);
}

export function findDuplicates(files, allowed = new Set()) {
  const seen = new Map();
  for (const { path, blocks } of files) {
    for (const block of blocks) {
      for (const sentence of sentences(block.text)) {
        if (allowed.has(sentence)) continue;
        if (!seen.has(sentence)) seen.set(sentence, []);
        seen.get(sentence).push(`${path}:${block.line}`);
      }
    }
  }
  return [...seen.entries()]
    .filter(([, sites]) => new Set(sites.map((s) => s.split(':')[0])).size > 1)
    .map(([sentence, sites]) => ({ sentence, sites: [...new Set(sites)] }));
}

// Only backticked identifiers. An unquoted CamelCase word in prose is a English
// noun as often as it is a symbol, and flagging those buries the real hits.
const IDENTIFIER = /`(#?[A-Za-z_$][A-Za-z0-9_$]*)(?:\(\))?`/g;
// Must start with a word character, so a bare extension — comments here discuss
// `.svelte.ts` as a category — is not read as a file that ought to exist.
const FILENAME = /(?<![\w/.-])(\w[\w.-]*\.(?:ts|svelte|mjs|css|html))(?![\w-])/g;
const PROXIMITY = /\b(beside|next to|alongside|in the same (?:directory|folder)|in src\/\w+)\b/i;

// Names that are real but belong to something other than this repo's source.
const EXTERNAL = new Set([
  'skipWaiting', // Workbox, implied by registerType: 'autoUpdate' in vite.config.ts
  'clientsClaim',
]);

export function findBadReferences(files, index) {
  const problems = [];
  const declared = index.symbols;
  for (const { path, blocks } of files) {
    for (const block of blocks) {
      const at = `${path}:${block.line}`;
      for (const [, name] of block.text.matchAll(IDENTIFIER)) {
        const bare = name.replace(/^#/, '');
        if (EXTERNAL.has(bare) || declared.has(bare)) continue;
        problems.push({ at, detail: `\`${name}\` matches no identifier in the tree` });
      }
      for (const [, named] of block.text.matchAll(FILENAME)) {
        const matches = index.files.get(named);
        if (matches === undefined) {
          problems.push({ at, detail: `${named} does not exist` });
          continue;
        }
        // "beside X" is a claim about where X is, not just that it exists. This
        // is the one that caught a comment naming a file one directory over.
        if (!PROXIMITY.test(block.text)) continue;
        const here = dirname(path);
        if (!matches.some((match) => dirname(match) === here)) {
          problems.push({
            at,
            detail: `claims ${named} is nearby, but it is only at ${matches.join(', ')}`,
          });
        }
      }
    }
  }
  return problems;
}

// Every file in the repo, not only the scanned sources: a comment may name a
// stylesheet or an html entry, and indexing only what is parsed for comments
// would report those as missing.
async function repoFiles() {
  const found = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'coverage'].includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else found.push(relative(ROOT, full));
    }
  }
  await walk(ROOT);
  return found;
}

function buildIndex(loaded, allPaths) {
  const files = new Map();
  const symbols = new Set();
  for (const path of allPaths) {
    const name = basename(path);
    if (!files.has(name)) files.set(name, []);
    files.get(name).push(path);
  }
  for (const { source } of loaded) {
    // Code lines only: a symbol that exists solely inside another comment is not
    // evidence that it exists.
    for (const line of source.split('\n')) {
      const trimmed = line.trim();
      if (/^(\/\/|\/\*|\*|<!--)/.test(trimmed)) continue;
      for (const [, word] of line.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)/g)) symbols.add(word);
    }
  }
  return { files, symbols };
}

async function loadAllowlist() {
  try {
    const raw = await readFile(join(ROOT, 'scripts/comment-allowlist.txt'), 'utf8');
    return new Set(
      raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
    );
  } catch {
    return new Set();
  }
}

async function run(paths, allowed) {
  const loaded = await Promise.all(
    paths.map(async (path) => ({ path, source: await readFile(path, 'utf8') }))
  );
  const files = loaded.map(({ path, source }) => ({
    path: relative(ROOT, path),
    blocks: commentBlocks(source),
  }));
  return {
    duplicates: findDuplicates(files, allowed),
    references: findBadReferences(files, buildIndex(loaded, await repoFiles())),
  };
}

function report({ duplicates, references }) {
  for (const { sentence, sites } of duplicates) {
    console.log(`  ✗ same sentence in ${String(sites.length)} files`);
    for (const site of sites) console.log(`      ${site}`);
    console.log(`      "${sentence.slice(0, 100)}${sentence.length > 100 ? '…' : ''}"`);
  }
  for (const { at, detail } of references) console.log(`  ✗ ${at}: ${detail}`);
  return duplicates.length + references.length;
}

if (SELFTEST) {
  // Both checks run against text built to trip them. A checker that has drifted
  // out of matching anything passes the real tree and fails here.
  const shared =
    'This is a deliberately long shared sentence written only so that the duplicate check has something it must report.';
  const files = [
    { path: 'a/one.ts', blocks: [{ line: 1, text: shared }] },
    { path: 'b/two.ts', blocks: [{ line: 1, text: shared }] },
  ];
  const index = { files: new Map([['real.ts', ['src/elsewhere/real.ts']]]), symbols: new Set() };
  const cases = [
    ['duplicate sentence across two files', findDuplicates(files).length === 1],
    [
      'duplicate suppressed by the allowlist',
      findDuplicates(files, new Set([shared])).length === 0,
    ],
    [
      'backticked identifier that does not exist',
      findBadReferences(
        [{ path: 'a.ts', blocks: [{ line: 1, text: '`noSuchSymbol` is gone' }] }],
        index
      ).length === 1,
    ],
    [
      'named file that does not exist',
      findBadReferences(
        [{ path: 'a.ts', blocks: [{ line: 1, text: 'see missing.ts for this' }] }],
        index
      ).length === 1,
    ],
    [
      'file claimed to be beside a file that is elsewhere',
      findBadReferences(
        [{ path: 'src/lib/a.ts', blocks: [{ line: 1, text: 'lives here beside real.ts today' }] }],
        index
      ).length === 1,
    ],
    [
      'no complaint when the nearby file really is nearby',
      findBadReferences(
        [
          {
            path: 'src/elsewhere/a.ts',
            blocks: [{ line: 1, text: 'lives here beside real.ts today' }],
          },
        ],
        index
      ).length === 0,
    ],
    ['a short shared fragment is not a duplicate', sentences('Test seam.').length === 0],
    [
      'a bare extension is not read as a missing file',
      findBadReferences(
        [{ path: 'a.ts', blocks: [{ line: 1, text: 'kept out of `.svelte.ts` on purpose' }] }],
        index
      ).length === 0,
    ],
  ];
  console.log('check:comments --selftest — sensitivity');
  let failed = 0;
  for (const [name, passed] of cases) {
    console.log(`  ${passed ? '✓' : '✗'} ${name}`);
    if (!passed) failed += 1;
  }
  if (failed > 0) {
    console.error(`\ncheck:comments --selftest — ${String(failed)} case(s) did not fire.`);
    process.exit(1);
  }
  console.log('\ncheck:comments --selftest — all cases fire.');
  process.exit(0);
}

const problems = report(await run(await sourceFiles(), await loadAllowlist()));
if (problems > 0) {
  console.error(
    `\ncheck:comments — ${String(problems)} problem(s).\n` +
      'A duplicated rule wants one owner and a shortened copy; see the header of this file.'
  );
  process.exit(1);
}
console.log('check:comments — no duplicated or unresolvable comment claims.');
