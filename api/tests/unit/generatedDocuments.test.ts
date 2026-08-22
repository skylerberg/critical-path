import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// openapi.json and realtime-events.json are dumps, gitignored so that a payload or
// schema change does not also produce a diff in a 140KB generated file. Gitignore
// only stops an *untracked* file from being added, though, so a branch cut before
// the untracking still carries the tracked copy: merging main into it raises a
// modify/delete conflict, and resolving that in favor of "modified" — the side
// git's own hint suggests — quietly puts the file back. realtime-events.json
// returned exactly that way within an hour of being removed.
const GENERATED_DOCUMENTS = ['openapi.json', 'realtime-events.json'];

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// The whole repository, not this package: since the monorepo, api/ is a
// directory rather than the checkout root, and a dump can land beside it — at
// the root itself, where the CLI's generator was caught re-dumping to, or under
// web/ or cli/. Scanning only from here would call every one of those clean.
function repositoryRoot(): string | null {
  try {
    return git(['rev-parse', '--show-toplevel'], packageRoot).trim();
  } catch {
    // No git available — a source tarball or an image build. Nothing to check.
    return null;
  }
}

// Filtered by basename rather than by a git pathspec, so the match does not
// depend on glob magic behaving the same at the root as it does one level down.
function trackedGeneratedDocuments(root: string): string[] {
  return git(['ls-files', '-z'], root)
    .split('\0')
    .filter(Boolean)
    .filter((path) => GENERATED_DOCUMENTS.includes(basename(path)))
    .sort();
}

describe('generated documents', () => {
  it('are dumped, never committed, anywhere in the repository', () => {
    const root = repositoryRoot();
    if (root === null) return;

    const tracked = trackedGeneratedDocuments(root);

    expect(
      tracked,
      `Tracked generated document(s): ${tracked.join(', ')} (relative to ${root}). ` +
        'These are dumps and must stay untracked — a merge that resolved a ' +
        'modify/delete conflict in favor of "modified" is the usual way one comes ' +
        'back. Run `git rm --cached <path>` on each.'
    ).toEqual([]);
  });

  // The guard's own control. Every broken state here exits 0 quietly — a
  // pathspec that stopped matching, a scan rooted at the wrong directory —
  // and each of those leaves the assertion above green forever. This plants
  // one document at a scratch repository's root and one inside its api/
  // package and requires the scan to report both.
  it('reports a document tracked at the repository root, not only inside api/', () => {
    const root = mkdtempSync(join(tmpdir(), 'generated-documents-'));
    try {
      git(['init', '-q'], root);
      mkdirSync(join(root, 'api'), { recursive: true });
      writeFileSync(join(root, 'openapi.json'), '{}');
      writeFileSync(join(root, 'api', 'realtime-events.json'), '{}');
      writeFileSync(join(root, 'api', 'package.json'), '{}');
      git(['add', '-A', '-f'], root);

      expect(trackedGeneratedDocuments(root)).toEqual(['api/realtime-events.json', 'openapi.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
