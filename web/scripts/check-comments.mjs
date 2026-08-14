#!/usr/bin/env node
// Two things written prose gets wrong, both of which a reader takes on trust.
//
//   npm run check:comments
//
// 1. The same rationale copied into two files. Whichever copy is not next to the
//    code that changes is the one that goes stale, and nothing points the editor
//    of one at the other. Fix by giving the rule a single owner — the module that
//    implements it — and cutting the copy down to what is local to its own site.
// 2. A file or symbol named in prose that no longer resolves, or that resolves
//    somewhere other than where the prose places it.
//
// Neither is a style rule. Both were found live: a `#sendOrFail` doc that
// miscounted its own call sites, and a comment placing a test helper in the
// directory next door to the one it is actually in.
//
// The markdown under DOCS is read the same way, because it makes the same two
// mistakes with none of the pressure that keeps a comment honest — nothing
// recompiles when a doc goes wrong. Both had drifted by the time this grew to
// cover them: a skill telling everyone to run the formatter the post-commit hook
// already runs, and a README describing a generator flag that had changed
// meaning.
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
// Prose that is nobody's compile error. Plans under .claude/ are deliberately
// out: they record what was decided at a moment and are not maintained against
// the tree afterwards, so holding them to a reference check would only teach
// people to delete the history.
const DOCS = ['CLAUDE.md', 'README.md', '.pi/skills'];
// Configuration is indexed as source without being read for prose: the docs name
// compiler options and npm scripts as often as they name functions, and a key in
// tsconfig.json is no less real for living outside src/.
const CONFIG = ['svelte.config.js', 'eslint.config.js', 'tsconfig.json', 'package.json'];
// Generated clients carry the API's own prose, which is duplicated across
// endpoints by design and is not ours to edit.
// scripts/tmp-* is the throwaway-probe prefix: copied from a real module as often
// as not, so its comments are duplicates by construction and say nothing about
// this tree.
const SKIP = (path) =>
  path.includes('.generated.') || path.includes('node_modules') || /\/tmp-[^/]*$/.test(path);

// A sentence shorter than this is a fragment ("Test seam.", "Best effort:") that
// two files can share without either being a copy of the other.
const MIN_SENTENCE = 55;

async function walkFor(dir, matches, found) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (SKIP(full)) continue;
    if (entry.isDirectory()) await walkFor(full, matches, found);
    else if (matches(entry.name)) found.push(full);
  }
}

async function sourceFiles() {
  const found = [];
  const matches = (name) => EXTENSIONS.some((ext) => name.endsWith(ext));
  for (const dir of SCANNED) await walkFor(join(ROOT, dir), matches, found);
  found.push(join(ROOT, 'vite.config.ts'));
  return found;
}

// A DOCS entry is either a file or a directory to walk for markdown.
async function docFiles() {
  const found = [];
  for (const entry of DOCS) {
    const full = join(ROOT, entry);
    if (entry.endsWith('.md')) found.push(full);
    else await walkFor(full, (name) => name.endsWith('.md'), found);
  }
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

// Markdown is prose all the way down, so its blocks are paragraphs, list items
// and headings — one claim each, the way a run of comment lines is one claim.
//
// Fenced code is dropped. Two documents listing the same command are not two
// copies of one rationale, and those commands are the part that SHOULD agree;
// reading them as prose would report every shared example and bury the real hits.
export function proseBlocks(source) {
  const blocks = [];
  let current = null;
  let fenced = false;
  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      fenced = !fenced;
      current = null;
      return;
    }
    if (fenced || trimmed === '') {
      current = null;
      return;
    }
    const marker = /^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/.exec(trimmed);
    const text = trimmed.slice(marker === null ? 0 : marker[0].length);
    // A marker starts a claim even with no blank line above it, so consecutive
    // bullets are reported at their own line rather than at the top of the list.
    if (current === null || marker !== null) {
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
// `.svelte.ts` as a category — is not read as a file that ought to exist. The
// extensions are narrower than REPO_PATH's on purpose: a bare `openapi.json` or
// `realtime-events.json` is the api repo's, named here constantly and correctly.
const FILENAME = /(?<![\w/.-])(\w[\w.-]*\.(?:ts|svelte|mjs|js|css|html))(?![\w-])/g;
// A path is a claim about this repo's tree, and resolving it as one is what gives
// the check any teeth on the docs, which cite `src/lib/ranks.ts` where a comment
// would say `ranks.ts`. `/` is in the lookbehind so a path sitting inside a
// longer one — `../critical-path-api/CLAUDE.md`, another repo's file — is not
// read as a claim about this tree. A glob has no `/`-free segments and so never
// matches, which is how `src/**/*.test.ts` stays out of it.
const REPO_PATH =
  /(?<![\w./-])((?:[\w.-]+\/)+[\w.-]+\.(?:ts|svelte|mjs|js|css|html|json|md|txt|ya?ml))(?![\w-])/g;
const PROXIMITY = /\b(beside|next to|alongside|in the same (?:directory|folder)|in src\/\w+)\b/i;

// Names that are real but belong to something other than this repo's source.
const EXTERNAL = new Set([
  'skipWaiting', // Workbox, implied by registerType: 'autoUpdate' in vite.config.ts
  'clientsClaim',
  'scrollY', // a browser global, named where the docs describe what focus does to it
  'props_duplicate', // svelte's own compile-error code
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
      for (const [, named] of block.text.matchAll(REPO_PATH)) {
        // Only a path rooted at something this repo actually has at top level is
        // a claim about this repo. That is what separates a moved file under
        // src/ from the three kinds of path that are nobody's mistake: the
        // companion repo's, an import written relative to a directory other than
        // this one, and the tail of a URL carrying a port. The selftest has one
        // of each.
        if (!index.roots.has(named.split('/')[0])) continue;
        if (!index.paths.has(named)) {
          problems.push({ at, detail: `${named} does not exist` });
        }
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
      if (entry.name.startsWith('tmp-')) continue;
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
  const paths = new Set(allPaths);
  const roots = new Set(allPaths.map((path) => path.split('/')[0]));
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
  return { files, paths, roots, symbols };
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

const load = (paths) =>
  Promise.all(paths.map(async (path) => ({ path, source: await readFile(path, 'utf8') })));

async function run(allowed) {
  const code = await load(await sourceFiles());
  const docs = await load(await docFiles());
  const config = await load(CONFIG.map((name) => join(ROOT, name)));
  const blocksOf = (loaded, extract) =>
    loaded.map(({ path, source }) => ({ path: relative(ROOT, path), blocks: extract(source) }));
  const files = [...blocksOf(code, commentBlocks), ...blocksOf(docs, proseBlocks)];
  // Symbols come from the code and config only. Indexing the docs would make
  // every name they mention exist by virtue of being mentioned, which is the one
  // thing this check is here to disprove.
  return {
    duplicates: findDuplicates(files, allowed),
    references: findBadReferences(files, buildIndex([...code, ...config], await repoFiles())),
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
  const index = {
    files: new Map([['real.ts', ['src/elsewhere/real.ts']]]),
    paths: new Set(['src/elsewhere/real.ts']),
    roots: new Set(['src']),
    symbols: new Set(),
  };
  const doc = [
    '# Heading',
    '',
    'A paragraph long enough that the duplicate check will not discard it as a fragment.',
    '',
    '```sh',
    'npm run something-shared-between-two-documents-that-is-not-a-duplicated-rationale',
    '```',
    '',
    '- A bullet that is also long enough to count as a sentence for these purposes.',
    '- A second bullet, likewise long enough to be counted as a sentence of its own.',
  ].join('\n');
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
    [
      'a path into this tree that does not exist',
      findBadReferences(
        [{ path: 'CLAUDE.md', blocks: [{ line: 1, text: 'see src/lib/gone.ts for this' }] }],
        index
      ).length === 1,
    ],
    [
      'a path into this tree that does exist',
      findBadReferences(
        [{ path: 'CLAUDE.md', blocks: [{ line: 1, text: 'see src/elsewhere/real.ts here' }] }],
        index
      ).length === 0,
    ],
    [
      "another repo's path is not read as a claim about this one",
      findBadReferences(
        [
          {
            path: 'CLAUDE.md',
            blocks: [{ line: 1, text: 'the companion has critical-path-api/src/real.ts' }],
          },
        ],
        index
      ).length === 0,
    ],
    [
      'a url tail is not read as a path',
      findBadReferences(
        [{ path: 'CLAUDE.md', blocks: [{ line: 1, text: 'open localhost:5180/src/probe.html' }] }],
        index
      ).length === 0,
    ],
    [
      'a glob is not read as a path',
      findBadReferences(
        [{ path: 'CLAUDE.md', blocks: [{ line: 1, text: 'tests live at src/**/*.test.ts here' }] }],
        index
      ).length === 0,
    ],
    ['markdown prose is read as blocks', proseBlocks(doc).length === 4],
    [
      'a fenced command block is not read as prose',
      proseBlocks(doc).every((block) => !block.text.startsWith('npm run')),
    ],
    [
      'consecutive bullets are separate blocks at their own lines',
      proseBlocks(doc).at(-1).line === 10,
    ],
    [
      'a doc paragraph duplicating a code comment is caught',
      findDuplicates([
        { path: 'CLAUDE.md', blocks: [{ line: 1, text: shared }] },
        { path: 'src/lib/a.ts', blocks: [{ line: 1, text: shared }] },
      ]).length === 1,
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

const problems = report(await run(await loadAllowlist()));
if (problems > 0) {
  console.error(
    `\ncheck:comments — ${String(problems)} problem(s).\n` +
      'A duplicated rule wants one owner and a shortened copy; see the header of this file.'
  );
  process.exit(1);
}
console.log('check:comments — no duplicated or unresolvable claims in comments or docs.');
