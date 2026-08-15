import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../../bin/cpath.mjs', import.meta.url));
const exec = promisify(execFile);

describe('cpath bin', () => {
  it('prints help via the tsx launcher', async () => {
    const { stdout } = await exec('node', [bin, '--help']);
    expect(stdout).toContain('Critical Path');
  });

  it('exits with the code the command computed, not 0', async () => {
    const configDir = join(await mkdtemp(join(tmpdir(), 'cpath-bin-')), 'config');
    let failure: { code?: number; stdout?: string; stderr?: string } | null = null;
    try {
      await exec('node', [bin, 'config', 'get', 'bogus'], {
        env: {
          ...process.env,
          CRITICAL_PATH_CONFIG_DIR: configDir,
          // Keeps createContext off the platform credential store, which would
          // otherwise reach the developer's real keychain.
          CRITICAL_PATH_TOKEN: 'unused-by-this-command',
        },
      });
    } catch (err) {
      failure = err as { code?: number; stdout?: string; stderr?: string };
    }
    expect(failure?.code).toBe(2);
    expect(failure?.stdout).toBe('');
    expect(failure?.stderr).toContain('Unknown config key "bogus"');
  });
});
