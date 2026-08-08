import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// openapi.json and realtime-events.json are dumps, gitignored so that a payload or
// schema change does not also produce a diff in a 140KB generated file. Gitignore
// only stops an *untracked* file from being added, though, so a branch cut before
// the untracking still carries the tracked copy: merging main into it raises a
// modify/delete conflict, and resolving that in favour of "modified" — the side
// git's own hint suggests — quietly puts the file back. realtime-events.json
// returned exactly that way within an hour of being removed.
const GENERATED_DOCUMENTS = ['openapi.json', 'realtime-events.json'];

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function trackedDocuments(): string[] | null {
  try {
    return execFileSync('git', ['ls-files', '--', ...GENERATED_DOCUMENTS], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    // No git available — a source tarball or an image build. Nothing to check.
    return null;
  }
}

describe('generated documents', () => {
  it('are dumped, never committed', () => {
    const tracked = trackedDocuments();
    if (tracked === null) return;

    expect(tracked).toEqual([]);
  });
});
