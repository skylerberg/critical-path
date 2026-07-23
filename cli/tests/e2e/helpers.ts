import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { app } from '../../../src/index';
import { run } from '../../src/run';
import { MemoryStore } from '../../src/credentials/memory';
import type { CliDeps } from '../../src/context';

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  json<T = unknown>(): T;
}

export interface CliHarness {
  credentials: MemoryStore;
  runCli(
    argv: string[],
    options?: { stdin?: string; env?: Record<string, string> }
  ): Promise<CliRunResult>;
}

export async function createCliHarness(): Promise<CliHarness> {
  const credentials = new MemoryStore();
  const configDir = join(await mkdtemp(join(tmpdir(), 'cpath-e2e-')), 'config');

  async function runCli(
    argv: string[],
    options: { stdin?: string; env?: Record<string, string> } = {}
  ): Promise<CliRunResult> {
    let stdout = '';
    let stderr = '';
    const stdin = new PassThrough();
    stdin.end(options.stdin ?? '');
    const deps: CliDeps = {
      env: { CRITICAL_PATH_CONFIG_DIR: configDir, ...options.env },
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
      fetch: async (request) => app.request(request),
      credentials,
    };
    const exitCode = await run(deps, ['node', 'cpath', ...argv]);
    return {
      exitCode,
      stdout,
      stderr,
      json: <T = unknown>() => JSON.parse(stdout) as T,
    };
  }

  return { credentials, runCli };
}
