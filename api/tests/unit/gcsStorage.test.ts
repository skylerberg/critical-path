import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable, Writable } from 'node:stream';

const bucketState = vi.hoisted(() => ({
  objects: new Map<string, { body: Buffer; generation: string }>(),
  readGenerations: [] as unknown[],
  writes: [] as { method: 'save' | 'createWriteStream'; key: string; options: unknown }[],
  copies: [] as { from: string; to: string }[],
  deleted: [] as string[],
  metadataError: null as Error | null,
  downloadError: null as Error | null,
  deleteError: null as Error | null,
}));

vi.mock('@google-cloud/storage', () => {
  const missingObject = (): Error => Object.assign(new Error('No such object'), { code: 404 });

  class FakeFile {
    constructor(
      private name: string,
      private options?: { generation?: unknown }
    ) {}

    getMetadata(): Promise<[{ size: string; generation: string }]> {
      if (bucketState.metadataError) {
        return Promise.reject(bucketState.metadataError);
      }
      const entry = bucketState.objects.get(this.name);
      if (!entry) {
        return Promise.reject(missingObject());
      }
      return Promise.resolve([{ size: String(entry.body.length), generation: entry.generation }]);
    }

    createReadStream(): Readable {
      bucketState.readGenerations.push(this.options?.generation);
      return Readable.from([bucketState.objects.get(this.name)!.body]);
    }

    save(data: Buffer, options?: unknown): Promise<void> {
      bucketState.writes.push({ method: 'save', key: this.name, options });
      bucketState.objects.set(this.name, { body: data, generation: '1' });
      return Promise.resolve();
    }

    createWriteStream(options?: unknown): Writable {
      bucketState.writes.push({ method: 'createWriteStream', key: this.name, options });
      const key = this.name;
      const chunks: Buffer[] = [];
      return new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
        final(callback) {
          bucketState.objects.set(key, { body: Buffer.concat(chunks), generation: '1' });
          callback();
        },
      });
    }

    download(): Promise<[Buffer]> {
      if (bucketState.downloadError) {
        return Promise.reject(bucketState.downloadError);
      }
      const entry = bucketState.objects.get(this.name);
      return entry ? Promise.resolve([entry.body]) : Promise.reject(missingObject());
    }

    copy(destination: FakeFile): Promise<void> {
      bucketState.copies.push({ from: this.name, to: destination.name });
      const entry = bucketState.objects.get(this.name);
      if (!entry) {
        return Promise.reject(missingObject());
      }
      bucketState.objects.set(destination.name, { ...entry });
      return Promise.resolve();
    }

    delete(): Promise<void> {
      if (bucketState.deleteError) {
        return Promise.reject(bucketState.deleteError);
      }
      if (!bucketState.objects.delete(this.name)) {
        return Promise.reject(missingObject());
      }
      bucketState.deleted.push(this.name);
      return Promise.resolve();
    }
  }

  class FakeBucket {
    file(name: string, options?: { generation?: unknown }): FakeFile {
      return new FakeFile(name, options);
    }
  }

  return {
    Storage: class {
      bucket(): FakeBucket {
        return new FakeBucket();
      }
    },
  };
});

const { GcsStorageProvider } = await import('../../src/services/storage/gcs');

describe('GcsStorageProvider', () => {
  let provider: InstanceType<typeof GcsStorageProvider>;

  beforeEach(() => {
    bucketState.objects.clear();
    bucketState.readGenerations.length = 0;
    bucketState.writes.length = 0;
    bucketState.copies.length = 0;
    bucketState.deleted.length = 0;
    bucketState.metadataError = null;
    bucketState.downloadError = null;
    bucketState.deleteError = null;
    provider = new GcsStorageProvider('test-bucket');
  });

  async function collect(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  describe('getStream', () => {
    it('reports the stored size as a number and streams the bytes', async () => {
      const key = crypto.randomUUID();
      bucketState.objects.set(key, { body: Buffer.from('stored bytes'), generation: '17' });

      const object = await provider.getStream(key);

      expect(object!.size).toBe(12);
      expect((await collect(object!.stream)).toString()).toBe('stored bytes');
    });

    it('resolves null for a missing object instead of opening a stream', async () => {
      expect(await provider.getStream(crypto.randomUUID())).toBeNull();
      expect(bucketState.readGenerations).toEqual([]);
    });

    it('pins the read to the generation the metadata reported', async () => {
      const key = crypto.randomUUID();
      bucketState.objects.set(key, { body: Buffer.from('v2'), generation: '99' });

      const object = await provider.getStream(key);
      await collect(object!.stream);

      expect(bucketState.readGenerations).toEqual(['99']);
    });

    it('propagates a metadata failure that is not a missing object', async () => {
      bucketState.metadataError = Object.assign(new Error('permission denied'), { code: 403 });

      await expect(provider.getStream(crypto.randomUUID())).rejects.toThrow('permission denied');
    });
  });

  // A resumable session buffers every chunk in memory to be able to replay it,
  // so an upload in flight would cost its own size in the pod.
  describe('put and putStream', () => {
    it('saves the bytes under the content type, and not as a resumable upload', async () => {
      const key = crypto.randomUUID();

      await provider.put(key, Buffer.from('one shot'), 'image/png');

      expect(bucketState.writes).toEqual([
        { method: 'save', key, options: { contentType: 'image/png', resumable: false } },
      ]);
      expect(bucketState.objects.get(key)!.body.toString()).toBe('one shot');
    });

    it('pipes a stream through on the same terms', async () => {
      const key = crypto.randomUUID();

      await provider.putStream(
        key,
        Readable.from([Buffer.from('first '), Buffer.from('second')]),
        'application/pdf'
      );

      expect(bucketState.writes).toEqual([
        {
          method: 'createWriteStream',
          key,
          options: { contentType: 'application/pdf', resumable: false },
        },
      ]);
      expect(bucketState.objects.get(key)!.body.toString()).toBe('first second');
    });
  });

  describe('get', () => {
    it('returns the stored bytes', async () => {
      const key = crypto.randomUUID();
      bucketState.objects.set(key, { body: Buffer.from('stored bytes'), generation: '3' });

      expect((await provider.get(key))!.toString()).toBe('stored bytes');
    });

    // The callers turn null into a 404; a thrown 404 would be a 500 instead.
    it('resolves null for a missing object', async () => {
      expect(await provider.get(crypto.randomUUID())).toBeNull();
    });

    it('propagates a download failure that is not a missing object', async () => {
      bucketState.downloadError = Object.assign(new Error('permission denied'), { code: 403 });

      await expect(provider.get(crypto.randomUUID())).rejects.toThrow('permission denied');
    });
  });

  describe('delete', () => {
    it('removes the object', async () => {
      const key = crypto.randomUUID();
      bucketState.objects.set(key, { body: Buffer.from('doomed'), generation: '1' });

      await provider.delete(key);

      expect(bucketState.deleted).toEqual([key]);
      expect(bucketState.objects.has(key)).toBe(false);
    });

    // Reclaim runs in a post-commit hook, and an object already gone is the
    // outcome it wanted.
    it('swallows a delete of an object that is already gone', async () => {
      await expect(provider.delete(crypto.randomUUID())).resolves.toBeUndefined();
    });

    it('propagates a delete failure that is not a missing object', async () => {
      bucketState.deleteError = Object.assign(new Error('permission denied'), { code: 403 });

      await expect(provider.delete(crypto.randomUUID())).rejects.toThrow('permission denied');
    });
  });

  describe('copy', () => {
    it('copies the source object onto the destination key', async () => {
      const source = crypto.randomUUID();
      const destination = crypto.randomUUID();
      bucketState.objects.set(source, { body: Buffer.from('original'), generation: '1' });

      await provider.copy(source, destination);

      expect(bucketState.copies).toEqual([{ from: source, to: destination }]);
      expect(bucketState.objects.get(destination)!.body.toString()).toBe('original');
    });
  });

  it('rejects a non-UUID key on every method before it reaches the bucket', async () => {
    const bad = '../../etc/passwd';
    const good = crypto.randomUUID();
    bucketState.objects.set(good, { body: Buffer.from('untouched'), generation: '1' });

    await expect(provider.getStream(bad)).rejects.toThrow('Invalid storage key');
    await expect(provider.put(bad, Buffer.from('x'), 'text/plain')).rejects.toThrow(
      'Invalid storage key'
    );
    await expect(provider.putStream(bad, Readable.from(['x']), 'text/plain')).rejects.toThrow(
      'Invalid storage key'
    );
    await expect(provider.get(bad)).rejects.toThrow('Invalid storage key');
    await expect(provider.delete(bad)).rejects.toThrow('Invalid storage key');
    await expect(provider.copy(bad, good)).rejects.toThrow('Invalid storage key');
    await expect(provider.copy(good, bad)).rejects.toThrow('Invalid storage key');

    expect(bucketState.writes).toEqual([]);
    expect(bucketState.copies).toEqual([]);
    expect(bucketState.deleted).toEqual([]);
    expect(bucketState.readGenerations).toEqual([]);
    expect([...bucketState.objects.keys()]).toEqual([good]);
  });
});
