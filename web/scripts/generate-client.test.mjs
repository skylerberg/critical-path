// The generator these two packages share lives at ../../scripts/lib, outside
// either of them, so neither package's other checks look at it. This file is
// where it is held to what it does — and to still being one program.
import { describe, expect, test } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { filterDeprecated } from '../../scripts/lib/openapi-filter.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

function spec({ paths = {}, schemas = {} }) {
  return { openapi: '3.1.0', paths, components: { schemas } };
}

describe('filterDeprecated', () => {
  test('removes a deprecated operation and the path left with no methods', () => {
    const doc = spec({
      paths: {
        '/api/old': { post: { deprecated: true, responses: {} } },
        '/api/both': { get: { responses: {} }, delete: { deprecated: true, responses: {} } },
      },
    });

    expect(filterDeprecated(doc).removedOps).toBe(2);
    expect(Object.keys(doc.paths)).toEqual(['/api/both']);
    expect(Object.keys(doc.paths['/api/both'])).toEqual(['get']);
  });

  // Only method keys count towards keeping a path: one left with nothing but
  // `parameters` describes no request any client could make.
  test('drops a path left with no methods but other keys', () => {
    const doc = spec({
      paths: { '/api/old': { parameters: [], get: { deprecated: true, responses: {} } } },
    });

    filterDeprecated(doc);
    expect(doc.paths).toEqual({});
  });

  // The half the CLI's copy of this generator never had: deleting the operation
  // leaves its request body behind as an exported type, and a call site written
  // against that type compiles.
  test('prunes a schema only the deprecated operation referenced', () => {
    const doc = spec({
      paths: {
        '/api/old': {
          post: {
            deprecated: true,
            requestBody: { content: { 'application/json': { schema: ref('OldBody') } } },
            responses: {},
          },
        },
        '/api/live': {
          get: { responses: { 200: { content: { 'application/json': { schema: ref('Task') } } } } },
        },
      },
      schemas: { OldBody: { type: 'object' }, Task: { type: 'object' } },
    });

    expect(filterDeprecated(doc).removedSchemas).toBe(1);
    expect(Object.keys(doc.components.schemas)).toEqual(['Task']);
  });

  test('keeps a schema reachable only through another schema', () => {
    const doc = spec({
      paths: {
        '/api/live': {
          get: {
            responses: { 200: { content: { 'application/json': { schema: ref('Board') } } } },
          },
        },
      },
      schemas: {
        Board: { type: 'object', properties: { columns: { items: ref('Column') } } },
        Column: { type: 'object', properties: { tasks: { items: ref('Task') } } },
        Task: { type: 'object' },
        Orphan: { type: 'object' },
      },
    });

    expect(filterDeprecated(doc).removedSchemas).toBe(1);
    expect(Object.keys(doc.components.schemas)).toEqual(['Board', 'Column', 'Task']);
  });

  test('keeps a schema reachable from a component other than schemas', () => {
    const doc = spec({ schemas: { Problem: { type: 'object' } } });
    doc.components.responses = {
      Error: { content: { 'application/json': { schema: ref('Problem') } } },
    };

    expect(filterDeprecated(doc).removedSchemas).toBe(0);
    expect(Object.keys(doc.components.schemas)).toEqual(['Problem']);
  });

  test('removes a schema marked deprecated even where something still points at it', () => {
    const doc = spec({
      paths: {
        '/api/live': {
          get: { responses: { 200: { content: { 'application/json': { schema: ref('Gone') } } } } },
        },
      },
      schemas: { Gone: { type: 'object', deprecated: true } },
    });

    expect(filterDeprecated(doc).removedSchemas).toBe(1);
    expect(doc.components.schemas).toEqual({});
  });
});

// A fork of these two files is what the shared library exists to end, and it is
// the kind that reappears quietly: one package gets a fix and the other keeps
// generating a client that is subtly different. Below the leading comment the two
// are the same text, and staying that way is the property worth failing over —
// anything a package genuinely needs of its own belongs in an argument to the
// shared generator, not in a second copy of it.
describe('the two packages run the same generator', () => {
  const body = (path) =>
    readFileSync(resolve(REPO_ROOT, path), 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('//') && !line.startsWith('#!'))
      .join('\n')
      .trim();

  test.each([['generate-api-types.mjs'], ['generate-realtime-types.mjs']])(
    '%s is the same file in web/scripts and cli/scripts below its opening comment',
    (name) => {
      expect(body(`cli/scripts/${name}`)).toBe(body(`web/scripts/${name}`));
    }
  );
});

// scripts/generate-clients.sh is the one command, and CI re-runs it — but it is
// shell, which nothing here type-checks, lints or resolves. Its six steps name
// package scripts by string, and the rename that unified these two packages
// (`generate-api` -> `generate:api`) is exactly the edit that would leave those
// strings naming nothing while every other check stayed green.
describe('scripts/generate-clients.sh', () => {
  const script = readFileSync(resolve(REPO_ROOT, 'scripts', 'generate-clients.sh'), 'utf8');
  const steps = [...script.matchAll(/^step (\S+) (\S+)$/gm)].map(([, pkg, name]) => [pkg, name]);
  const scriptsOf = (pkg) =>
    JSON.parse(readFileSync(resolve(REPO_ROOT, pkg, 'package.json'), 'utf8')).scripts;

  test('every step names a script that package actually has', () => {
    expect(steps.length).toBeGreaterThan(0);
    for (const [pkg, name] of steps) {
      expect(Object.keys(scriptsOf(pkg))).toContain(name);
    }
  });

  test('it runs every client generator both packages define', () => {
    for (const pkg of ['web', 'cli']) {
      const generators = Object.keys(scriptsOf(pkg)).filter((name) => name.startsWith('generate:'));
      expect(generators.length).toBe(2);
      for (const name of generators) {
        expect(steps).toContainEqual([pkg, name]);
      }
    }
  });

  // The dumps are what the four generators read. Running them first is also what
  // makes a broken dump fail at its own step, rather than as four clients
  // generated from a stale file by a re-dump that is best-effort by design.
  test('both dumps run before any client is generated', () => {
    const lastDump = steps.findLastIndex(([pkg]) => pkg === 'api');
    const firstClient = steps.findIndex(([pkg]) => pkg !== 'api');
    expect(steps.filter(([pkg]) => pkg === 'api').map(([, name]) => name)).toEqual([
      'openapi:dump',
      'realtime:dump',
    ]);
    expect(lastDump).toBeLessThan(firstClient);
  });

  test('it is executable', () => {
    const { mode } = statSync(resolve(REPO_ROOT, 'scripts', 'generate-clients.sh'));
    expect(mode & 0o111).not.toBe(0);
  });
});

// What lets the regenerated clients ride along in the api commit without
// breaking the two-commit deploy rule: they contain types and nothing else, so
// the web deploy one triggers ships an identical bundle. codegen-ci.yaml's
// header states that reasoning, and this is the assertion behind it — a
// generator change that started emitting a runtime value would silently make
// that comment false.
describe('the generated clients emit no runtime values', () => {
  test.each([
    ['web/src/api/api.generated.ts'],
    ['web/src/api/realtime.generated.ts'],
    ['cli/src/api/api.generated.ts'],
    ['cli/src/api/realtime.generated.ts'],
  ])('%s declares only types', (path) => {
    const offenders = readFileSync(resolve(REPO_ROOT, path), 'utf8')
      .split('\n')
      .filter((line) => /^export (const|function|class|let|var|enum) /.test(line));

    expect(offenders).toEqual([]);
  });
});
