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

export interface CliRunHandle {
  output(): string;
  errorOutput(): string;
  interrupt(): void;
  done: Promise<CliRunResult>;
}

export interface CliRunOptions {
  stdin?: string;
  env?: Record<string, string>;
  onRequest?: (request: Request) => void;
}

export interface CliHarness {
  credentials: MemoryStore;
  configDir: string;
  runCli(argv: string[], options?: CliRunOptions): Promise<CliRunResult>;
  startCli(argv: string[], options?: CliRunOptions): CliRunHandle;
}

export async function createCliHarness(): Promise<CliHarness> {
  const credentials = new MemoryStore();
  const configDir = join(await mkdtemp(join(tmpdir(), 'cpath-e2e-')), 'config');

  function startCli(argv: string[], options: CliRunOptions = {}): CliRunHandle {
    let stdout = '';
    let stderr = '';
    let interruptHandler: (() => void) | null = null;
    const stdin = new PassThrough();
    stdin.end(options.stdin ?? '');
    const deps: CliDeps = {
      env: {
        CRITICAL_PATH_CONFIG_DIR: configDir,
        CRITICAL_PATH_API_URL: 'http://localhost:3001',
        ...options.env,
      },
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
      fetch: async (request) => {
        options.onRequest?.(request);
        return app.request(request);
      },
      credentials,
      onInterrupt: (handler) => {
        interruptHandler = handler;
        return () => {
          if (interruptHandler === handler) {
            interruptHandler = null;
          }
        };
      },
    };
    const done = run(deps, ['node', 'cpath', ...argv]).then((exitCode) => ({
      exitCode,
      stdout,
      stderr,
      json: <T = unknown>() => JSON.parse(stdout) as T,
    }));
    return {
      output: () => stdout,
      errorOutput: () => stderr,
      interrupt: () => {
        const handler = interruptHandler;
        if (handler === null) {
          // Throwing beats hanging: the command never registered a handler, so it
          // would ignore the interrupt and never finish.
          throw new Error('the command has not registered an interrupt handler');
        }
        handler();
      },
      done,
    };
  }

  return {
    credentials,
    configDir,
    runCli: (argv, options) => startCli(argv, options).done,
    startCli,
  };
}
