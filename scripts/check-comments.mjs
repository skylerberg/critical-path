#!/usr/bin/env node
// Two things written prose gets wrong, both of which a reader takes on trust.
//
//   node scripts/check-comments.mjs
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
// The markdown is read the same way, because it makes the same two mistakes with
// none of the pressure that keeps a comment honest — nothing recompiles when a
// doc goes wrong. Both had drifted by the time this grew to cover them: a skill
// telling everyone to run the formatter the post-commit hook already runs, and a
// README describing a generator flag that had changed meaning.
//
// It reads the whole repository, and that is the point. While this lived in
// web/ and was rooted there it could not see one word of api/, cli/ or
// preview-edge/ — so the sentences the four packages had copied into each other
// during the merge were the one class of duplicate it was structurally unable to
// report, and a comment naming another package's file resolved against nothing
// and was waved through. Both of those are now failures.
//
// `--selftest` re-runs both checks against text that is deliberately wrong and
// fails if either reports clean. Run it after changing what they assert: a
// checker that has stopped matching anything reports the same green as a clean
// tree.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, basename } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SELF = relative(ROOT, fileURLToPath(import.meta.url));
const SELFTEST = process.argv.includes('--selftest');

// Prose is policed in the two languages this repository writes prose in: code
// comments and markdown. Everything else that is text — the workflows, the
// manifests, the terraform, the hooks — is indexed for the names it declares and
// never read for prose. That is the same line PR2 drew when it started indexing
// the root generator without policing it, moved from "outside this package" to
// "not a language anyone writes rationale in here". It is a real limit rather
// than an exemption: `.github/workflows/*.yaml` carries some of the longest
// rationale in the tree and none of it is checked, so a duplicated paragraph
// there is still nobody's error.
const PROSE_CODE = ['.ts', '.svelte', '.mjs', '.js'];
const PROSE_DOC = ['.md'];
// Never opened at all. The lockfiles are excluded for a second reason on top of
// their size: indexing them would declare every transitive dependency's name as
// a symbol of this tree, and almost any backticked word would then resolve.
const BINARY = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.woff', '.woff2', '.ttf'];
// `.claude/` is out for a reason of its own, carried over from when this listed
// the documents it read one by one: plans there record what was decided at a
// moment and are not maintained against the tree afterwards, so holding them to
// a reference check would only teach people to delete the history.
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.claude',
  'dist',
  'dev-dist',
  'coverage',
  'data',
]);
// Read for neither prose nor symbols, but still real files that prose may name.
// Generated clients carry the API's own prose, duplicated across endpoints by
// design and not ours to edit; a lockfile would declare every transitive
// dependency's name as a symbol of this tree, after which almost any backticked
// word would resolve.
const OPAQUE = (path) => path.includes('.generated.') || basename(path) === 'pnpm-lock.yaml';
// tmp-* is the throwaway-probe prefix: copied from a real module as often as
// not, so its comments are duplicates by construction and say nothing about
// this tree. Gone from the file index too, so a comment naming one is a broken
// reference rather than a claim resting on somebody's uncommitted scratch file.
const SKIP = (path) => /(^|\/)tmp-/.test(path);

// Files that are deliberate copies of each other, kept in step by hand because
// the packaging forbids sharing one. Listing a group here is not an exemption:
// it is a stronger claim than the duplicate check makes anywhere else — the
// files must be byte for byte identical, and this fails if either drifts or
// disappears.
//
// Empty on purpose. The one pair this was built for was `setup-hooks.mjs` in
// api/ and web/, forced apart because api's Dockerfile copied `api/scripts` into
// the image so `prepare` could run and a repository-root path was not in its
// build context. It is now one script at `scripts/setup-hooks.mjs` that all four
// packages call, so there is no copy left to police. Deleting one is always
// better than declaring it here; the check stays so that declaring one means
// something.
//
// Only a copy the packaging forces belongs here. A pair that is merely the same
// document filed twice — as the cli-tasks skill was, in two packages, neither of
// which builds the tool it describes — has an owner and wants a pointer at the
// other end instead.
const MIRRORS = [];

// A sentence shorter than this is a fragment ("Test seam.", "Best effort:") that
// two files can share without either being a copy of the other.
const MIN_SENTENCE = 55;

// One walk, classified by extension, rather than a list of directories per
// package: a package that grows a directory — or a fifth package — is covered
// without anyone remembering to come back here.
async function walk(dir, found) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const path = relative(ROOT, full);
    if (SKIP(path)) continue;
    if (entry.isDirectory()) {
      found.dirs.push(path);
      await walk(full, found);
    } else {
      found.paths.push(path);
      if (OPAQUE(path)) continue;
      if (PROSE_CODE.some((ext) => entry.name.endsWith(ext))) found.code.push(path);
      else if (PROSE_DOC.some((ext) => entry.name.endsWith(ext))) found.docs.push(path);
      else if (!BINARY.some((ext) => entry.name.endsWith(ext))) found.config.push(path);
    }
  }
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
//
// Table rows go the same way, and for the same reason one step further out: a
// table is a datum per cell, not a claim per row. Nothing separates the rows, so
// a whole comparison matrix arrives as one paragraph, and its cells are where
// prose keeps the things that are deliberately not names in this tree — another
// product's column, a commit sha, a shortcut key.
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
    if (fenced || trimmed === '' || trimmed.startsWith('|')) {
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

// `mirrors` maps a path to the group it is a declared copy within. A sentence
// whose sites all sit inside one such group is the copy that group already
// promises; one that reaches outside it is a duplicate like any other.
export function findDuplicates(files, allowed = new Set(), mirrors = new Map()) {
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
    .map(([sentence, sites]) => ({ sentence, sites: [...new Set(sites)] }))
    .filter(({ sites }) => {
      const paths = new Set(sites.map((site) => site.slice(0, site.lastIndexOf(':'))));
      if (paths.size < 2) return false;
      const groups = new Set([...paths].map((path) => mirrors.get(path)));
      return groups.size > 1 || groups.has(undefined);
    });
}

// Only backticked identifiers. An unquoted CamelCase word in prose is a English
// noun as often as it is a symbol, and flagging those buries the real hits.
const IDENTIFIER = /`(#?[A-Za-z_$][A-Za-z0-9_$]*)(?:\(\))?`/g;
// Must start with a word character, so a bare extension — comments here discuss
// `.svelte.ts` as a category — is not read as a file that ought to exist. The
// extensions stay narrower than REPO_PATH's, and the reason changed with the
// merge rather than going away: a bare `openapi.json` is one of the two spec
// dumps, a gitignored build product that exists only after a generator run, and
// a bare `package.json`, `tsconfig.json` or `CLAUDE.md` names four different
// files. A directory in front settles the four-of-a-kind ones, which is the
// form REPO_PATH below checks; it does not settle the dumps, and GENERATED is
// why.
const FILENAME = /(?<![\w/.-])(\w[\w.-]*\.(?:ts|svelte|mjs|js|css|html))(?![\w-])/g;
// A path is a claim about this repo's tree, and resolving it as one is what gives
// the check any teeth on the docs, which cite `src/lib/ranks.ts` where a comment
// would say `ranks.ts`. `/` is in the lookbehind so a path sitting inside a
// longer one — the tail of a URL, an absolute path on someone's laptop — is not
// read as a claim about this tree. A glob has no `/`-free segments and so never
// matches, which is how `src/**/*.test.ts` stays out of it.
const REPO_PATH =
  /(?<![\w./-])((?:[\w.-]+\/)+[\w.-]+\.(?:ts|svelte|mjs|js|css|html|json|md|txt|ya?ml))(?![\w-])/g;
const PROXIMITY = /\b(beside|next to|alongside|in the same (?:directory|folder)|in src\/\w+)\b/i;
// The two repositories this one was merged from. A path still rooted at either
// names a tree that no longer exists, and every such path was a live falsehood
// when this widened: one placed the CLI's short-link encoder in a repository, one
// placed a web-link list in one, and one carried a whole absolute path out of
// somebody's home directory. Matched on its own rather than through REPO_PATH,
// which the absolute form slips past entirely.
const FORMER_REPO = /(?<![\w-])critical-path-(?:api|web)\//g;

// Names that are real but belong to something other than this repo's source. A
// name here that the tree does declare is reported, the way a dead allowlist
// entry is: an exemption nobody needs is an exemption nobody has re-read, and
// each of these is one release or one shipped feature away from being wrong.
// The list grew when this widened past web/, because api's prose speaks SQL and
// psql and GCP where web's speaks TypeScript, and a backtick there marks a
// literal rather than a symbol.
const EXTERNAL = new Set([
  // Workbox's, implied by registerType: 'autoUpdate' in web/vite.config.ts.
  'skipWaiting',
  'clientsClaim',
  // Svelte's own compile-error code, and a pnpm default this repo names but
  // never sets.
  'props_duplicate',
  'strictDepBuilds',
  // SQL. The api's prose names these constantly and its code never does: Kysely
  // builds the clauses, so the keyword reaches no source line.
  'CHECK',
  'TRUNCATE',
  'LIMIT',
  'RESTRICT',
  // Postgres and the tools around it — a client, a server setting, an extension
  // the search docs weigh, and the example database name in the test-database
  // walkthrough.
  'psql',
  'max_connections',
  'pg_trgm',
  'critical_path_test_api_3f2a1b9c',
  // kysely-codegen's own environment variable. This server reads DB_HOSTNAME and
  // its siblings and never this, which is exactly what the prose naming it says.
  'DATABASE_URL',
  // Values another system reports back: `gh pr view --json mergeStateStatus`,
  // and the two certificate states the GCP console shows.
  'CLEAN',
  'PROVISIONING',
  'CNAME_MISMATCH',
  // Another pnpm default, named in a workspace file's comment and never set.
  'enableGlobalVirtualStore',
  // Terraform and IAM vocabulary, in prose about the infrastructure: a URL-map
  // block type and the principal form a workload-identity binding is written in.
  'path_rule',
  'principalSet',
  // A half-typed word, quoted as the input it is, in the paragraph about prefix
  // search meeting stemming.
  'testin',
  // The feature survey under docs/ quotes other products and proposes columns
  // nobody has built: two competitors' date-input literals, a table of Planka's,
  // an extension of Deck's, and three fields that would only exist if the
  // features they belong to ship. If one does ship, the check above says so.
  'fri',
  'tod',
  'planka_automations',
  'column_entered_at',
  'starred',
  'share_token',
]);

// Repo-relative paths this tree produces and deliberately does not track. Both
// spec dumps are pure functions of the api package's src, written by
// `openapi:dump` and `realtime:dump` and excluded by that package's .gitignore,
// so they exist after a generator run and never in a fresh checkout — which is
// precisely what repo-ci's `comments` job is: a checkout, no install, no dump.
// Naming them in prose is correct and the walk cannot see them, so without this
// the two documents every client is generated from would be the one pair of
// paths their own docs may not mention. No dead-suppression guard to match
// EXTERNAL's, because the failure this could hide — a dump committed by
// accident — is already the whole job of the generated-documents guard in the
// api suite.
const GENERATED = new Set(['api/openapi.json', 'api/realtime-events.json']);

// A path in prose resolves from the repository root, and then from the package
// the prose lives in — web/CLAUDE.md says `src/lib/ranks.ts` and means
// `web/src/lib/ranks.ts`, while the same document says `api/src/index.ts` and
// means it from the root. Only a first segment that names a real directory at
// one of those two levels makes the string a claim at all, which is what keeps
// the two kinds of path that are nobody's mistake out: an import written
// relative to a directory other than either, and the tail of a URL carrying a
// port. The selftest has one of each.
function resolutions(index, path, named) {
  const head = named.slice(0, named.indexOf('/'));
  const pkg = path.includes('/') ? path.slice(0, path.indexOf('/')) : '';
  const candidates = [];
  if (index.dirs.has(head)) candidates.push(named);
  if (pkg !== '' && index.dirs.has(`${pkg}/${head}`)) candidates.push(`${pkg}/${named}`);
  return candidates;
}

export function findBadReferences(files, index) {
  const problems = [];
  const declared = index.symbols;
  for (const { path, blocks } of files) {
    for (const block of blocks) {
      const at = `${path}:${block.line}`;
      for (const [, name] of block.text.matchAll(IDENTIFIER)) {
        const bare = name.replace(/^#/, '');
        // A backticked word that names a file is a file, not a missing symbol:
        // `CODEOWNERS` and `Dockerfile` carry their own names nowhere inside
        // themselves, so nothing declares them but the tree.
        if (EXTERNAL.has(bare) || declared.has(bare) || index.files.has(bare)) continue;
        problems.push({ at, detail: `\`${name}\` matches no identifier in the tree` });
      }
      for (const [former] of block.text.matchAll(FORMER_REPO)) {
        problems.push({
          at,
          detail: `${former} is a repository this one absorbed; the file is in this tree now`,
        });
      }
      for (const [, named] of block.text.matchAll(REPO_PATH)) {
        const candidates = resolutions(index, path, named);
        if (candidates.length === 0) continue;
        if (candidates.some((candidate) => GENERATED.has(candidate))) continue;
        if (!candidates.some((candidate) => index.paths.has(candidate))) {
          problems.push({ at, detail: `${candidates.join(' / ')} does not exist` });
        }
      }
      for (const [, named] of block.text.matchAll(FILENAME)) {
        // `Node.js` is a product, not a module. Nothing in this tree is a
        // capitalised `.js` — the four that exist are eslint.config.js and its
        // siblings — where a capitalised `.svelte` is every component there is.
        if (named.endsWith('.js') && /^[A-Z]/.test(named)) continue;
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

function buildIndex(loaded, tree) {
  const files = new Map();
  const symbols = new Set();
  const paths = new Set(tree.paths);
  const dirs = new Set(tree.dirs);
  for (const path of tree.paths) {
    const name = basename(path);
    if (!files.has(name)) files.set(name, []);
    files.get(name).push(path);
  }
  for (const { path, source } of loaded) {
    // Code lines only: a symbol that exists solely inside another comment is not
    // evidence that it exists. Which marker starts a comment depends on the file:
    // `#` opens one in YAML, in shell and in the hooks, and opens a private
    // field in TypeScript, so a single shared pattern would either index that
    // prose as symbols or stop indexing every `#name` in the stores.
    //
    // `.env.test` is matched on the `.env` rather than on a final extension.
    // scripts/bootstrap.sh seeds it and its siblings from tracked examples, so
    // their comments are prose someone wrote — and read as code every word of it
    // becomes a name this tree declares, which is how a comment there quietly
    // satisfied a reference the checker exists to disprove.
    const hash =
      /\.(ya?ml|sh|tf|hcl|toml|txt|env|example|gitignore|dockerignore)$/.test(path) ||
      /(^|\/)\.env(\.|$)/.test(path);
    const comment = hash || !/\.[a-z]+$/.test(path) ? /^#/ : /^(\/\/|\/\*|\*|<!--)/;
    for (const line of source.split('\n')) {
      const trimmed = line.trim();
      if (comment.test(trimmed)) continue;
      for (const [, word] of line.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)/g)) symbols.add(word);
    }
  }
  return { files, paths, dirs, symbols };
}

async function loadAllowlist() {
  const raw = await readFile(join(ROOT, 'scripts/comment-allowlist.txt'), 'utf8');
  return new Set(
    raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
  );
}

const load = (paths) =>
  Promise.all(paths.map(async (path) => ({ path, source: await readFile(join(ROOT, path), 'utf8') })));

// Every declared copy must exist and must still be a copy. A pair that has
// drifted is the failure this list is here to catch; a pair that has lost a file
// means the list itself is stale, and either way the duplicate check has been
// quietly ignoring sentences on the strength of a promise nobody kept.
export function checkMirrors(sources, groups = MIRRORS) {
  const problems = [];
  for (const group of groups) {
    const found = group.map((path) => sources.get(path));
    const missing = group.filter((path, at) => found[at] === undefined);
    if (missing.length > 0) {
      problems.push({
        at: 'scripts/check-comments.mjs',
        detail: `MIRRORS names ${missing.join(', ')}, which no longer exists`,
      });
      continue;
    }
    if (new Set(found).size > 1) {
      problems.push({
        at: group[0],
        detail: `is a declared copy of ${group.slice(1).join(', ')} and no longer matches it`,
      });
    }
  }
  return problems;
}

// A suppression that would report nothing if it were deleted is one nobody has
// re-read since whatever it was written for went away — the same failure as a
// check that has stopped matching, wearing the same green.
export function findDeadSuppressions(files, allowed, mirrors, declared, external = EXTERNAL) {
  const problems = [];
  const live = new Set(findDuplicates(files, new Set(), mirrors).map(({ sentence }) => sentence));
  for (const sentence of allowed) {
    if (live.has(sentence)) continue;
    problems.push({
      at: 'scripts/comment-allowlist.txt',
      detail: `no longer suppresses anything: "${sentence.slice(0, 60)}…"`,
    });
  }
  for (const name of external) {
    if (!declared.has(name)) continue;
    problems.push({
      at: 'scripts/check-comments.mjs',
      detail: `EXTERNAL lists \`${name}\`, which the tree now declares itself`,
    });
  }
  return problems;
}

async function run(allowed) {
  const tree = { paths: [], dirs: [], code: [], docs: [], config: [] };
  await walk(ROOT, tree);
  const code = await load(tree.code);
  const docs = await load(tree.docs);
  const config = await load(tree.config);
  const blocksOf = (loaded, extract) =>
    loaded.map(({ path, source }) => ({ path, blocks: extract(source) }));
  const files = [...blocksOf(code, commentBlocks), ...blocksOf(docs, proseBlocks)];
  const mirrors = new Map();
  MIRRORS.forEach((group, at) => group.forEach((path) => mirrors.set(path, at)));
  const sources = new Map([...code, ...docs].map(({ path, source }) => [path, source]));
  // Symbols come from the code and the configuration only. Indexing the docs
  // would make every name they mention exist by virtue of being mentioned, which
  // is the one thing this check is here to disprove.
  const index = buildIndex([...code, ...config], tree);
  // A second index without this file, and only for the question of whether an
  // EXTERNAL name has become real. Every one of them is written out as a string
  // literal a few lines above, on a code line, so measured against the first
  // index every exemption declares itself and the check reports all of them.
  const elsewhere = buildIndex(
    [...code, ...config].filter(({ path }) => path !== SELF),
    tree
  );
  return {
    duplicates: findDuplicates(files, allowed, mirrors),
    references: [
      ...findBadReferences(files, index),
      ...checkMirrors(sources),
      ...findDeadSuppressions(files, allowed, mirrors, elsewhere.symbols),
    ],
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
    { path: 'web/src/one.ts', blocks: [{ line: 1, text: shared }] },
    { path: 'api/src/two.ts', blocks: [{ line: 1, text: shared }] },
  ];
  // The two levels a path in prose resolves from, and nothing else: `web` and
  // `api` are directories of the repository, `web/src` and `api/src` are
  // directories of their packages.
  const index = {
    files: new Map([['real.ts', ['web/src/elsewhere/real.ts']]]),
    paths: new Set(['web/src/elsewhere/real.ts', 'api/src/there.ts']),
    dirs: new Set(['api', 'api/src', 'web', 'web/src', 'web/src/elsewhere', 'web/src/lib']),
    symbols: new Set(),
  };
  const refs = (path, text) => findBadReferences([{ path, blocks: [{ line: 1, text }] }], index);
  const mirrors = new Map([
    ['api/scripts/twin.mjs', 0],
    ['web/scripts/twin.mjs', 0],
  ]);
  const twins = [
    { path: 'api/scripts/twin.mjs', blocks: [{ line: 1, text: shared }] },
    { path: 'web/scripts/twin.mjs', blocks: [{ line: 1, text: shared }] },
  ];
  const duplicatesOf = (given) => findDuplicates(given, new Set(), mirrors).length;
  // `undefined` for the twin is the file having disappeared, which is what a
  // Map lookup hands back and what the missing-file arm has to read.
  const mirrorProblems = (one, other) =>
    checkMirrors(
      new Map([
        ['api/scripts/twin.mjs', one],
        ...(other === undefined ? [] : [['web/scripts/twin.mjs', other]]),
      ]),
      [['api/scripts/twin.mjs', 'web/scripts/twin.mjs']]
    ).length;
  const doc = [
    '# Heading',
    '',
    'A paragraph long enough that the duplicate check will not discard it as a fragment.',
    '',
    '```sh',
    'pnpm run something-shared-between-two-documents-that-is-not-a-duplicated-rationale',
    '```',
    '',
    '- A bullet that is also long enough to count as a sentence for these purposes.',
    '- A second bullet, likewise long enough to be counted as a sentence of its own.',
  ].join('\n');
  // The one arm that runs against the repository rather than against a fixture,
  // because the scope is the thing this file most recently changed and a fixture
  // cannot show that the walk leaves a package out.
  const tree = { paths: [], dirs: [], code: [], docs: [], config: [] };
  await walk(ROOT, tree);
  const reaches = (list, prefixes) =>
    prefixes.every((prefix) => list.some((path) => path.startsWith(prefix)));
  const cases = [
    ['duplicate sentence across two packages', findDuplicates(files).length === 1],
    [
      'duplicate suppressed by the allowlist',
      findDuplicates(files, new Set([shared])).length === 0,
    ],
    ['duplicate inside a declared mirror is not reported', duplicatesOf(twins) === 0],
    [
      'the same sentence reaching outside the mirror is reported',
      duplicatesOf([...twins, { path: 'cli/src/three.ts', blocks: [{ line: 1, text: shared }] }]) === 1,
    ],
    ['a mirror that has drifted is reported', mirrorProblems('one', 'other') === 1],
    ['a mirror whose twin is gone is reported', mirrorProblems('one', undefined) === 1],
    ['a mirror that still matches is not reported', mirrorProblems('one', 'one') === 0],
    [
      'an allowlist entry that suppresses nothing is reported',
      findDeadSuppressions(
        [],
        new Set(['a sentence no file in this repository contains at all']),
        new Map(),
        new Set(),
        new Set()
      ).length === 1,
    ],
    [
      'an allowlist entry that is still doing work is not reported',
      findDeadSuppressions(files, new Set([shared]), new Map(), new Set(), new Set()).length === 0,
    ],
    [
      'an EXTERNAL name the tree now declares is reported',
      findDeadSuppressions([], new Set(), new Map(), new Set(['scrollY']), new Set(['scrollY']))
        .length === 1,
    ],
    [
      'backticked identifier that does not exist',
      refs('web/src/a.ts', '`noSuchSymbol` is gone').length === 1,
    ],
    ['named file that does not exist', refs('web/src/a.ts', 'see missing.ts for this').length === 1],
    [
      'file claimed to be beside a file that is elsewhere',
      refs('web/src/lib/a.ts', 'lives here beside real.ts today').length === 1,
    ],
    [
      'no complaint when the nearby file really is nearby',
      refs('web/src/elsewhere/a.ts', 'lives here beside real.ts today').length === 0,
    ],
    ['a short shared fragment is not a duplicate', sentences('Test seam.').length === 0],
    [
      'a bare extension is not read as a missing file',
      refs('web/src/a.ts', 'kept out of `.svelte.ts` on purpose').length === 0,
    ],
    [
      'a package-relative path resolves against the package the prose is in',
      refs('web/CLAUDE.md', 'see src/elsewhere/real.ts here').length === 0,
    ],
    [
      'a package-relative path that is not there is reported',
      refs('web/CLAUDE.md', 'see src/lib/gone.ts for this').length === 1,
    ],
    [
      'a path into another package is resolved from the repository root',
      refs('web/CLAUDE.md', 'the api holds api/src/there.ts now').length === 0,
    ],
    [
      'a path into another package that does not exist is reported',
      refs('web/CLAUDE.md', 'the api holds api/src/absent.ts now').length === 1,
    ],
    // The exemption and its control together. Without the second, GENERATED
    // widening to swallow every untracked path would still pass here.
    [
      'a path the tree generates but does not track is not reported',
      refs('api/CLAUDE.md', 'both generators read api/openapi.json first').length === 0,
    ],
    [
      'a path that is merely absent is still reported',
      refs('api/CLAUDE.md', 'both generators read api/nothing.json first').length === 1,
    ],
    [
      'a path rooted at a repository this one absorbed is a broken reference',
      refs('web/src/a.ts', 'the CLI copy is at critical-path-api/cli/src/twin.ts').length === 1,
    ],
    [
      'an absolute path into an absorbed repository is a broken reference too',
      refs('docs/a.md', 'the bus is at /Users/someone/Code/critical-path-web/src/bus.ts').length === 1,
    ],
    [
      'a url tail is not read as a path',
      refs('CLAUDE.md', 'open localhost:5180/src/probe.html').length === 0,
    ],
    [
      'a glob is not read as a path',
      refs('CLAUDE.md', 'tests live at src/**/*.test.ts here').length === 0,
    ],
    ['markdown prose is read as blocks', proseBlocks(doc).length === 4],
    [
      'a fenced command block is not read as prose',
      proseBlocks(doc).every((block) => !block.text.startsWith('pnpm run')),
    ],
    [
      'consecutive bullets are separate blocks at their own lines',
      proseBlocks(doc).at(-1).line === 10,
    ],
    [
      'a doc paragraph duplicating a code comment is caught',
      findDuplicates([
        { path: 'web/CLAUDE.md', blocks: [{ line: 1, text: shared }] },
        { path: 'web/src/lib/a.ts', blocks: [{ line: 1, text: shared }] },
      ]).length === 1,
    ],
    [
      'the walk reaches the code of every package and the root scripts',
      reaches(tree.code, ['api/', 'cli/', 'preview-edge/', 'web/', 'scripts/']),
    ],
    [
      'the walk reaches the prose of every package, docs/ and the root',
      reaches(tree.docs, ['api/', 'web/', 'docs/', 'scripts/', 'README.md', 'CLAUDE.md']),
    ],
    [
      'the walk indexes the manifests and workflows without reading them for prose',
      reaches(tree.config, ['.github/workflows/', 'api/package.json', 'infra/']) &&
        !tree.docs.some((path) => path.endsWith('.yaml')),
    ],
    [
      'generated clients and lockfiles are indexed as files but never read',
      tree.paths.some((path) => path.includes('.generated.')) &&
        ![...tree.code, ...tree.docs, ...tree.config].some(
          (path) => path.includes('.generated.') || path.endsWith('pnpm-lock.yaml')
        ),
    ],
    [
      'a throwaway probe is out of the tree entirely, its own name included',
      SKIP('web/scripts/tmp-probe.mjs') &&
        !SKIP('web/scripts/generate-api-types.mjs') &&
        !tree.paths.some((path) => /(^|\/)tmp-/.test(path)),
    ],
  ];
  console.log('check-comments --selftest — sensitivity');
  let failed = 0;
  for (const [name, passed] of cases) {
    console.log(`  ${passed ? '✓' : '✗'} ${name}`);
    if (!passed) failed += 1;
  }
  if (failed > 0) {
    console.error(`\ncheck-comments --selftest — ${String(failed)} case(s) did not fire.`);
    process.exit(1);
  }
  console.log('\ncheck-comments --selftest — all cases fire.');
  process.exit(0);
}

const problems = report(await run(await loadAllowlist()));
if (problems > 0) {
  console.error(
    `\ncheck-comments — ${String(problems)} problem(s).\n` +
      'A duplicated rule wants one owner and a shortened copy; see the header of this file.'
  );
  process.exit(1);
}
console.log('check-comments — no duplicated or unresolvable claims in comments or docs.');
