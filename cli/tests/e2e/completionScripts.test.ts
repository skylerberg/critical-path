import { describe, it, expect } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createCliHarness } from './helpers';

function installed(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const SHELLS = [
  { shell: 'bash', syntaxCheck: ['-n'] },
  { shell: 'zsh', syntaxCheck: ['-n'] },
];

describe('generated completion scripts', () => {
  for (const { shell, syntaxCheck } of SHELLS) {
    it.skipIf(!installed(shell))(`parses as valid ${shell}`, async () => {
      const h = await createCliHarness();
      const res = await h.runCli(['completion', '-s', shell]);
      expect(res.exitCode).toBe(0);

      const path = join(await mkdtemp(join(tmpdir(), 'cpath-script-')), `cpath.${shell}`);
      await writeFile(path, res.stdout);
      await expect(promisify(execFile)(shell, [...syntaxCheck, path])).resolves.toBeDefined();
    });
  }
});
