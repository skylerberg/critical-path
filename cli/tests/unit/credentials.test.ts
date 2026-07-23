import { describe, it, expect } from 'vitest';
import { mkdtemp, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeychainStore, type SecurityRunner } from '../../src/credentials/keychain';
import { FileStore } from '../../src/credentials/fileStore';
import { MemoryStore } from '../../src/credentials/memory';

const BASE_URL = 'http://localhost:3001';
const TOKEN = 'abc123_-XYZ';

class FakeRunner implements SecurityRunner {
  execCalls: string[][] = [];
  batchCalls: string[] = [];
  stored: string | null = null;

  async exec(args: string[]): Promise<{ stdout: string }> {
    this.execCalls.push(args);
    if (args[0] === 'find-generic-password') {
      if (this.stored == null) {
        throw new Error('The specified item could not be found in the keychain.');
      }
      return { stdout: `${this.stored}\n` };
    }
    if (args[0] === 'delete-generic-password') {
      if (this.stored == null) {
        throw new Error('The specified item could not be found in the keychain.');
      }
      this.stored = null;
      return { stdout: '' };
    }
    return { stdout: '' };
  }

  async batch(commands: string): Promise<void> {
    this.batchCalls.push(commands);
    const match = commands.match(/-w "([^"]+)"/);
    this.stored = match ? match[1] : null;
  }
}

describe('KeychainStore', () => {
  it('stores the token via stdin batch mode, never via argv', async () => {
    const runner = new FakeRunner();
    const store = new KeychainStore(runner);
    await store.set(BASE_URL, TOKEN);
    expect(runner.batchCalls).toHaveLength(1);
    expect(runner.batchCalls[0]).toContain(TOKEN);
    for (const args of runner.execCalls) {
      expect(args).not.toContain(TOKEN);
      expect(args.join(' ')).not.toContain(TOKEN);
    }
  });

  it('round-trips get after set', async () => {
    const store = new KeychainStore(new FakeRunner());
    await store.set(BASE_URL, TOKEN);
    expect(await store.get(BASE_URL)).toBe(TOKEN);
  });

  it('returns null when the item is missing', async () => {
    const store = new KeychainStore(new FakeRunner());
    expect(await store.get(BASE_URL)).toBeNull();
  });

  it('rejects tokens with characters that would break quoting', async () => {
    const store = new KeychainStore(new FakeRunner());
    await expect(store.set(BASE_URL, 'has space')).rejects.toThrow(/unsafe|quotes/i);
    await expect(store.set(BASE_URL, 'has"quote')).rejects.toThrow(/unsafe|quotes/i);
    await expect(store.set(BASE_URL, 'has\nnewline')).rejects.toThrow(/unsafe|quotes/i);
  });

  it('fails when the write cannot be verified', async () => {
    const runner = new FakeRunner();
    runner.batch = async () => {};
    const store = new KeychainStore(runner);
    await expect(store.set(BASE_URL, TOKEN)).rejects.toThrow(/verified/);
  });

  it('treats deleting an absent item as success', async () => {
    const store = new KeychainStore(new FakeRunner());
    await expect(store.delete(BASE_URL)).resolves.toBeUndefined();
  });
});

describe('FileStore', () => {
  it('round-trips tokens and restricts file permissions', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'cpath-test-')), 'creds');
    const store = new FileStore(dir);
    expect(await store.get(BASE_URL)).toBeNull();
    await store.set(BASE_URL, TOKEN);
    expect(await store.get(BASE_URL)).toBe(TOKEN);

    const dirMode = (await stat(dir)).mode & 0o777;
    const fileMode = (await stat(join(dir, 'credentials.json'))).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);

    const contents = JSON.parse(await readFile(join(dir, 'credentials.json'), 'utf8'));
    expect(contents).toEqual({ [BASE_URL]: TOKEN });

    await store.delete(BASE_URL);
    expect(await store.get(BASE_URL)).toBeNull();
  });

  it('keys tokens by base URL', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'cpath-test-')), 'creds');
    const store = new FileStore(dir);
    await store.set('http://localhost:3001', 'token-a');
    await store.set('https://example.com', 'token-b');
    expect(await store.get('http://localhost:3001')).toBe('token-a');
    expect(await store.get('https://example.com')).toBe('token-b');
  });
});

describe('MemoryStore', () => {
  it('round-trips tokens', async () => {
    const store = new MemoryStore();
    expect(await store.get(BASE_URL)).toBeNull();
    await store.set(BASE_URL, TOKEN);
    expect(await store.get(BASE_URL)).toBe(TOKEN);
    await store.delete(BASE_URL);
    expect(await store.get(BASE_URL)).toBeNull();
  });
});
