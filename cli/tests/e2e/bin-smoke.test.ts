import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../../bin/cpath.mjs', import.meta.url));

describe('cpath bin', () => {
  it('prints help via the tsx launcher', async () => {
    const { stdout } = await promisify(execFile)('node', [bin, '--help']);
    expect(stdout).toContain('Critical Path');
  });
});
