import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

const bucketState = vi.hoisted(() => ({
  objects: new Map<string, { body: Buffer; generation: string }>(),
  readGenerations: [] as unknown[],
  metadataError: null as Error | null,
}));

vi.mock('@google-cloud/storage', () => {
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
        return Promise.reject(Object.assign(new Error('No such object'), { code: 404 }));
      }
      return Promise.resolve([{ size: String(entry.body.length), generation: entry.generation }]);
    }

    createReadStream(): Readable {
      bucketState.readGenerations.push(this.options?.generation);
      return Readable.from([bucketState.objects.get(this.name)!.body]);
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

describe('GcsStorageProvider.getStream', () => {
  let provider: InstanceType<typeof GcsStorageProvider>;

  beforeEach(() => {
    bucketState.objects.clear();
    bucketState.readGenerations.length = 0;
    bucketState.metadataError = null;
    provider = new GcsStorageProvider('test-bucket');
  });

  async function collect(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

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

  it('rejects a non-UUID key before it reaches the bucket', async () => {
    await expect(provider.getStream('../../etc/passwd')).rejects.toThrow('Invalid storage key');
  });
});
