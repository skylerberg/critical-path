import { execFileSync } from 'node:child_process';

// What is actually running, so "which build answered that?" is one request
// rather than an inference from timestamps.
//
// In a container there is no .git — the image copies source, not history — so
// the deploy substitutes the values into the manifest and they arrive as
// environment variables. In development they are absent and git is right there,
// which is the case that matters most locally: two worktrees serving on two
// ports look identical until one of them says which branch it is.

export interface BuildInfo {
  branch: string | null;
  commit: string | null;
}

const SHORT_COMMIT_LENGTH = 7;

function fromGit(args: string[]): string | null {
  try {
    return (
      execFileSync('git', args, {
        encoding: 'utf8',
        // Inherited stderr would print "not a git repository" on every boot
        // somewhere without one, which is not an error worth reporting.
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      }).trim() || null
    );
  } catch {
    return null;
  }
}

// Read once. The commit cannot change under a running process, and shelling out
// per request would put a subprocess spawn on the readiness probe's path.
let cached: BuildInfo | null = null;

export function buildInfo(): BuildInfo {
  if (cached) return cached;

  const branch = process.env.BUILD_BRANCH?.trim();
  const commit = process.env.BUILD_COMMIT?.trim();

  cached = {
    branch: branch || fromGit(['rev-parse', '--abbrev-ref', 'HEAD']),
    // Short, both because a full SHA reads as noise in a terminal and because
    // this is served publicly: seven characters identify the build to someone
    // who already has the repository and little to anyone who does not.
    commit: (commit || fromGit(['rev-parse', 'HEAD']))?.slice(0, SHORT_COMMIT_LENGTH) ?? null,
  };
  return cached;
}

export function resetBuildInfoCache(): void {
  cached = null;
}
