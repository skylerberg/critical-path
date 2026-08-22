import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { HEARTBEAT_INTERVAL_MS } from '../../src/services/realtime/heartbeat';
import { SEARCH_QUERY_MAX_LENGTH, SEARCH_QUERY_MIN_LENGTH } from '../../src/schemas/search';
import { BULK_TASK_LIMIT } from '../../src/schemas/taskBulk';
import { TASK_BATCH_LIMIT, TASK_TITLE_MAX_LENGTH } from '../../src/schemas/tasks';
import {
  USER_SEARCH_QUERY_MAX_LENGTH,
  USER_SEARCH_QUERY_MIN_LENGTH,
} from '../../src/schemas/users';

// The bounds web/ and cli/ refuse input against before spending a request. Each
// is a number this package decides and the client cannot import: four packages,
// four node_modules, no workspace, so nothing crosses those boundaries but the
// generated clients — and openapi-typescript emits types, never values, so a
// ceiling reaches a client only as a literal someone typed by hand.
//
// Left uncrossed, the drift is silent in the direction that costs most: a
// ceiling RAISED here leaves the client refusing input the server would take,
// with no error anywhere. This is documentedLimits.test.ts pointed across the
// repository instead of at the docs, and the row shape is the same one — the
// expectation is built FROM the constant, so a constant that moves without its
// client fails here rather than in someone's browser.
//
// What is deliberately NOT here: cli's copy of the socket heartbeat. That one is
// annotated with the literal type the realtime document publishes, so it is a
// compile error rather than a test — which is strictly better, and is the shape
// to prefer whenever a number can be published through the two clients at all.

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

// The whole repository, because every file below sits outside this package.
// Falls back to the parent directory rather than skipping: a source tarball with
// no git still has web/ and cli/ beside api/, and a check that quietly opts out
// on an unfamiliar checkout is one that has stopped running.
function repositoryRoot(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: packageRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return join(packageRoot, '..');
  }
}

const ROOT = repositoryRoot();

function read(file: string): string {
  const source = readFileSync(join(ROOT, file), 'utf8');
  // A file that has moved reads as an ENOENT above; one that has been emptied
  // would otherwise make every row about it pass a `null` comparison quietly.
  expect(source.length, `${file} is empty`).toBeGreaterThan(0);
  return source;
}

// The declaration, not a use: `<= MAX_SELECTION` would otherwise answer for the
// constant it is compared against. A type annotation may sit between the name
// and the `=`, which is how the heartbeat is written in cli/src/watch.ts.
function declaredNumber(source: string, identifier: string): number | null {
  const match = new RegExp(`\\bconst ${identifier}\\b[^=\\n]*=\\s*(\\d[\\d_]*)`).exec(source);
  return match === null ? null : Number(match[1].replaceAll('_', ''));
}

interface ClientLimit {
  what: string;
  value: number;
  file: string;
  identifier: string;
}

const LIMITS: ClientLimit[] = [
  {
    what: 'the longest title an input will accept',
    value: TASK_TITLE_MAX_LENGTH,
    file: 'web/src/lib/titles.ts',
    identifier: 'TASK_TITLE_MAX_LENGTH',
  },
  {
    what: 'the shortest search a keystroke will send',
    value: SEARCH_QUERY_MIN_LENGTH,
    file: 'web/src/lib/search-query.ts',
    identifier: 'SEARCH_MIN_QUERY_LENGTH',
  },
  {
    what: 'the longest search a keystroke will send',
    value: SEARCH_QUERY_MAX_LENGTH,
    file: 'web/src/lib/search-query.ts',
    identifier: 'SEARCH_MAX_QUERY_LENGTH',
  },
  {
    what: 'the shortest member search a picker will send',
    value: USER_SEARCH_QUERY_MIN_LENGTH,
    file: 'web/src/lib/userSearch.svelte.ts',
    identifier: 'USER_SEARCH_MIN_QUERY_LENGTH',
  },
  {
    what: 'the longest member search a picker will send',
    value: USER_SEARCH_QUERY_MAX_LENGTH,
    file: 'web/src/lib/userSearch.svelte.ts',
    identifier: 'USER_SEARCH_MAX_QUERY_LENGTH',
  },
  {
    what: 'the most cards a selection will hold, since every bulk action takes it whole',
    value: BULK_TASK_LIMIT,
    file: 'web/src/lib/selection.svelte.ts',
    identifier: 'MAX_SELECTION',
  },
  {
    what: 'the chunk the Trello import archives in',
    value: BULK_TASK_LIMIT,
    file: 'cli/src/trello/import.ts',
    identifier: 'BULK_TASK_CHUNK',
  },
  {
    what: 'the most tasks `cpath task create` will send in one batch',
    value: TASK_BATCH_LIMIT,
    file: 'cli/src/commands/task.ts',
    identifier: 'MAX_BATCH_TASKS',
  },
];

describe('client limits match the API constants that enforce them', () => {
  for (const limit of LIMITS) {
    it(`${limit.file} bounds ${limit.what}`, () => {
      expect(
        declaredNumber(read(limit.file), limit.identifier),
        `${limit.file} should declare ${limit.identifier} as ${String(limit.value)}, which is ` +
          `what this package enforces. Either the API constant moved and its client did not, ` +
          `or the client's constant was renamed — update whichever is now wrong.`
      ).toBe(limit.value);
    });
  }

  // The extractor's own control. Every way this check dies quietly — a renamed
  // constant, a declaration reworded past the pattern — reaches the assertions
  // above as `null`, which they do fail on; what they cannot tell you is whether
  // the pattern ever matched anything at all.
  it('reads a declaration and not a use, and reports a name it cannot find', () => {
    const source = 'const A_LIMIT = 2_000;\nif (n <= B_LIMIT) {}\nconst C: Named = 30_000;\n';
    expect(declaredNumber(source, 'A_LIMIT')).toBe(2000);
    expect(declaredNumber(source, 'C')).toBe(30000);
    expect(declaredNumber(source, 'B_LIMIT')).toBeNull();
    expect(declaredNumber(source, 'D_LIMIT')).toBeNull();
  });
});

// The socket heartbeat is the one number here that does cross as a type, and the
// annotation is what makes it cross. Drop the annotation and everything still
// compiles, everything stays green, and the protection is gone — which is the
// failure this describe exists to catch. What the annotation then buys is proved
// where it is spent: raising HEARTBEAT_INTERVAL_MS stops cli type-checking.
const HEARTBEAT_TYPE = "components['schemas']['RealtimeHeartbeatMs']";
// The sentence web used to carry. Written out so the assertion below fails on a
// figure creeping back rather than on a pattern that stopped matching anything.
const QUOTED_HEARTBEAT = /heartbeats? every \d/i;

describe('the socket heartbeat reaches its clients as a type', () => {
  it('has cli annotate its own copy rather than declare a bare number', () => {
    const source = read('cli/src/watch.ts');

    expect(
      source,
      `cli/src/watch.ts should annotate its heartbeat with ${HEARTBEAT_TYPE}. Without ` +
        'that annotation the number is an ordinary literal again and raising the ' +
        'interval here goes unnoticed until watchers start dropping healthy sockets.'
    ).toContain(HEARTBEAT_TYPE);
    expect(declaredNumber(source, 'SERVER_HEARTBEAT_MS')).toBe(HEARTBEAT_INTERVAL_MS);
  });

  it('leaves web quoting no interval of its own, having no use for the number', () => {
    expect(read('web/src/lib/realtime.svelte.ts')).not.toMatch(QUOTED_HEARTBEAT);
    // Control: the pattern does match the sentence it is here to keep out.
    expect(`the API heartbeats every ${String(HEARTBEAT_INTERVAL_MS / 1000)}s`).toMatch(
      QUOTED_HEARTBEAT
    );
  });
});

// Two clients, one close-code table each, and no module either can share. A
// pointer comment is the whole of what an editor of one is told about the other,
// so it has to be there and it has to name a file that is there too.
describe('the two realtime clients name each other', () => {
  const twins = [
    { file: 'web/src/lib/realtime.svelte.ts', names: 'cli/src/watch.ts' },
    { file: 'cli/src/watch.ts', names: 'web/src/lib/realtime.svelte.ts' },
  ];

  for (const { file, names } of twins) {
    it(`${file} points at ${names}`, () => {
      expect(read(file)).toContain(names);
      // The claim is only worth anything if the file it names is really there.
      expect(read(names).length).toBeGreaterThan(0);
    });
  }
});

// This suite runs from api-ci.yaml, whose `paths:` filter is scoped to the
// packages that workflow covers — api/, cli/ and preview-edge/. Every web file
// read above therefore has to be listed there by name, or an edit to it runs no
// workflow that can catch this drift, and the whole file becomes decoration.
describe('api-ci runs this check when the files it reads change', () => {
  it('lists every client file this suite reads', () => {
    const workflow = read('.github/workflows/api-ci.yaml');
    expect(workflow).toContain('pull_request:');

    const files = new Set([
      ...LIMITS.map((limit) => limit.file),
      'web/src/lib/realtime.svelte.ts',
      'cli/src/watch.ts',
    ]);
    const unlisted = [...files]
      .filter((file) => {
        const wholePackage = `'${file.split('/')[0]}/**'`;
        return !workflow.includes(wholePackage) && !workflow.includes(`'${file}'`);
      })
      .sort();

    expect(
      unlisted,
      'Each of these is read by this suite but matches no `paths:` entry in ' +
        'api-ci.yaml, so changing it triggers no run of the suite that checks it. ' +
        'Add each one to both `paths:` blocks and to the `client_mirrors` pattern ' +
        'in the `changes` job.'
    ).toEqual([]);
  });
});
