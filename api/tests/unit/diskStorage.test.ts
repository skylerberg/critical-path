import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { Readable } from 'node:stream';
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

  it('writes a stream in order', async () => {
    const key = crypto.randomUUID();
    await provider.putStream(
      key,
      Readable.from([Buffer.from('one '), Buffer.from('two '), Buffer.from('three')]),
      'application/octet-stream'
    );
    expect((await provider.get(key))!.toString()).toBe('one two three');
  });

  it('rejects when the source fails and leaves the partial object for the caller', async () => {
    const key = crypto.randomUUID();
    const source = new Readable({
      read() {
        this.push(Buffer.from('half'));
        this.destroy(new Error('source died'));
      },
    });

    await expect(provider.putStream(key, source, 'application/octet-stream')).rejects.toThrow(
      'source died'
    );
    await provider.delete(key);
    expect(await provider.get(key)).toBeNull();
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
    await expect(provider.getStream('../../etc/passwd')).rejects.toThrow('Invalid storage key');
    await expect(provider.delete('..')).rejects.toThrow('Invalid storage key');
    await expect(provider.copy('../a', crypto.randomUUID())).rejects.toThrow('Invalid storage key');
  });

  describe('getStream', () => {
    async function collect(stream: Readable): Promise<Buffer> {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks);
    }

    it('reports the stored size and streams the bytes', async () => {
      const key = crypto.randomUUID();
      const bytes = Buffer.alloc(3 * 1024 * 1024, 0x41);
      await provider.put(key, bytes, 'application/octet-stream');

      const object = await provider.getStream(key);

      expect(object).not.toBeNull();
      expect(object!.size).toBe(bytes.length);
      expect((await collect(object!.stream)).equals(bytes)).toBe(true);
    });

    it('reports zero for an empty object', async () => {
      const key = crypto.randomUUID();
      await provider.put(key, Buffer.alloc(0), 'application/octet-stream');

      const object = await provider.getStream(key);

      expect(object!.size).toBe(0);
      expect((await collect(object!.stream)).length).toBe(0);
    });

    it('resolves null for a missing key rather than failing mid-stream', async () => {
      expect(await provider.getStream(crypto.randomUUID())).toBeNull();
    });

    it('serves the measured bytes even if the object is deleted mid-response', async () => {
      const key = crypto.randomUUID();
      await provider.put(key, Buffer.from('still here'), 'application/octet-stream');

      const object = await provider.getStream(key);
      await provider.delete(key);

      expect(object!.size).toBe(10);
      expect((await collect(object!.stream)).toString()).toBe('still here');
    });

    it('propagates a failure that is not a missing object', async () => {
      const key = crypto.randomUUID();
      await provider.put(key, Buffer.from('x'), 'application/octet-stream');
      await fs.chmod(path.join(root, key), 0o000);

      try {
        await expect(provider.getStream(key)).rejects.toThrow();
      } finally {
        await fs.chmod(path.join(root, key), 0o600);
      }
    });
  });
});
