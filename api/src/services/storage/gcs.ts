import { Storage } from '@google-cloud/storage';
import type { Bucket } from '@google-cloud/storage';
import { isValidUuid } from '../../types/uuid';
import type { StorageProvider } from './types';

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
