import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { run } from '../../src/run';
import type { CliDeps } from '../../src/context';

async function runCli(argv: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  let stdout = '';
  let stderr = '';
  const stdin = new PassThrough();
  stdin.end('');
  const deps: CliDeps = {
    env: {},
    platform: 'linux',
    stdin,
    stdout: {
      write: (chunk: string) => {
        stdout += chunk;
      },
    },
    stderr: {
      write: (chunk: string) => {
        stderr += chunk;
      },
    },
    fetch: () => Promise.reject(new Error('no network in this test')),
  };
  const exitCode = await run(deps, ['node', 'cpath', ...argv]);
  return { exitCode, stdout, stderr };
}

// If run() ever stops configuring subcommands recursively, these cases stop failing
// and start killing the worker with process.exit.
describe('Commander errors below the root command', () => {
  it('maps an unknown option to the documented usage exit code', async () => {
    const res = await runCli(['task', 'list', '--bogus']);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('unknown option');
    expect(res.stdout).toBe('');
  });

  it('maps a missing required option to the usage exit code', async () => {
    const res = await runCli(['task', 'block', 'x']);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('--by');
  });

  it('routes subcommand help through the injected stdout', async () => {
    const res = await runCli(['task', '--help']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Manage tasks');
    expect(res.stderr).toBe('');
  });
});
