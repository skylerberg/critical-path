import { Storage } from '@google-cloud/storage';
import type { Bucket } from '@google-cloud/storage';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isValidUuid } from '../../types/uuid';
import type { StorageProvider, StoredObject } from './types';

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 404;
}

export class GcsStorageProvider implements StorageProvider {
  private bucket: Bucket;

  constructor(bucketName: string) {
    this.bucket = new Storage().bucket(bucketName);
  }

  // Keys are server-generated UUIDs; the check is defense in depth.
  private resolveKey(key: string): string {
    if (!isValidUuid(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return key;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.bucket.file(this.resolveKey(key)).save(data, {
      contentType,
      resumable: false,
    });
  }

  // Not resumable: a resumable session buffers chunks in memory to replay them.
  async putStream(key: string, data: Readable, contentType: string): Promise<void> {
    await pipeline(
      data,
      this.bucket.file(this.resolveKey(key)).createWriteStream({ contentType, resumable: false })
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const [data] = await this.bucket.file(this.resolveKey(key)).download();
      return data;
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }
  }

  // createReadStream cannot report a missing object as anything but a stream
  // error, so existence is settled by the metadata read first; the generation it
  // returns pins the read to the object that was measured.
  async getStream(key: string): Promise<StoredObject | null> {
    const resolved = this.resolveKey(key);
    let metadata;
    try {
      [metadata] = await this.bucket.file(resolved).getMetadata();
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }

    const file = this.bucket.file(resolved, { generation: metadata.generation });
    return { stream: file.createReadStream(), size: Number(metadata.size ?? 0) };
  }

  async copy(sourceKey: string, destKey: string): Promise<void> {
    await this.bucket
      .file(this.resolveKey(sourceKey))
      .copy(this.bucket.file(this.resolveKey(destKey)));
  }

  async delete(key: string): Promise<void> {
    try {
      await this.bucket.file(this.resolveKey(key)).delete();
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
    }
  }
}
