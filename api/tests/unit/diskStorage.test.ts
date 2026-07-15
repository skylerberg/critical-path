import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { DiskStorageProvider } from '../../src/services/storage/disk';

describe('DiskStorageProvider', () => {
  let root: string;
  let provider: DiskStorageProvider;

  beforeEach(() => {
    root = path.join('data', 'test-uploads', `unit-${crypto.randomUUID()}`);
    provider = new DiskStorageProvider(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('round-trips put and get', async () => {
    const key = crypto.randomUUID();
    await provider.put(key, Buffer.from('hello bytes'), 'image/png');
    const result = await provider.get(key);
    expect(result).not.toBeNull();
    expect(result!.toString()).toBe('hello bytes');
  });

  it('returns null for a missing key', async () => {
    expect(await provider.get(crypto.randomUUID())).toBeNull();
  });

  it('copies an object to a new key', async () => {
    const source = crypto.randomUUID();
    const dest = crypto.randomUUID();
    await provider.put(source, Buffer.from('copy me'), 'image/png');
    await provider.copy(source, dest);
    expect((await provider.get(dest))!.toString()).toBe('copy me');
    expect((await provider.get(source))!.toString()).toBe('copy me');
  });

  it('deletes an object', async () => {
    const key = crypto.randomUUID();
    await provider.put(key, Buffer.from('delete me'), 'image/png');
    await provider.delete(key);
    expect(await provider.get(key)).toBeNull();
  });

  it('does not throw when deleting a missing key', async () => {
    await expect(provider.delete(crypto.randomUUID())).resolves.toBeUndefined();
  });

  it('rejects non-UUID keys (path traversal defense)', async () => {
    await expect(provider.put('../escape', Buffer.from('x'), 'image/png')).rejects.toThrow(
      'Invalid storage key'
    );
    await expect(provider.get('../../etc/passwd')).rejects.toThrow('Invalid storage key');
    await expect(provider.delete('..')).rejects.toThrow('Invalid storage key');
    await expect(provider.copy('../a', crypto.randomUUID())).rejects.toThrow('Invalid storage key');
  });
});
