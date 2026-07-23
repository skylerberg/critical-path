import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { CredentialStore } from './store';

const SERVICE = 'critical-path-cli';
const pExecFile = promisify(execFile);

export interface SecurityRunner {
  exec(args: string[]): Promise<{ stdout: string }>;
  batch(commands: string): Promise<void>;
}

const realRunner: SecurityRunner = {
  exec(args) {
    return pExecFile('security', args);
  },
  // Batch mode takes commands on stdin so the token never appears in argv,
  // where any process could read it via ps.
  batch(commands) {
    return new Promise((resolve, reject) => {
      const child = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`security exited with code ${String(code)}: ${stderr.trim()}`));
        }
      });
      child.stdin.end(commands);
    });
  },
};

function assertSafe(value: string, what: string): void {
  if (!/^[\x21-\x7e]+$/.test(value) || value.includes('"') || value.includes('\\')) {
    throw new Error(`Refusing to store ${what} containing quotes, spaces, or control characters`);
  }
}

export class KeychainStore implements CredentialStore {
  #runner: SecurityRunner;

  constructor(runner: SecurityRunner = realRunner) {
    this.#runner = runner;
  }

  async get(baseUrl: string): Promise<string | null> {
    try {
      const { stdout } = await this.#runner.exec([
        'find-generic-password',
        '-a',
        baseUrl,
        '-s',
        SERVICE,
        '-w',
      ]);
      const token = stdout.trim();
      return token === '' ? null : token;
    } catch {
      return null;
    }
  }

  async set(baseUrl: string, token: string): Promise<void> {
    assertSafe(baseUrl, 'account');
    assertSafe(token, 'token');
    await this.#runner.batch(
      `add-generic-password -U -a "${baseUrl}" -s "${SERVICE}" -w "${token}"\n`
    );
    const stored = await this.get(baseUrl);
    if (stored !== token) {
      throw new Error('Keychain write could not be verified');
    }
  }

  async delete(baseUrl: string): Promise<void> {
    try {
      await this.#runner.exec(['delete-generic-password', '-a', baseUrl, '-s', SERVICE]);
    } catch {
      // Deleting an absent item is success for logout.
    }
  }
}
