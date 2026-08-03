import type { Readable } from 'node:stream';

export interface StoredObject {
  stream: Readable;
  size: number;
}

export interface StorageProvider {
  // contentType is unused by the disk driver but part of the contract so an
  // object-storage driver can set it without changing call sites.
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  // Must not buffer the source; a failed stream may leave a partial object,
  // which the caller reclaims.
  putStream(key: string, data: Readable, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  // Resolves null for a missing object before any byte is read, so a caller can
  // still answer 404; once the stream is handed over the only way left to
  // report a failure is to destroy it.
  getStream(key: string): Promise<StoredObject | null>;
  copy(sourceKey: string, destKey: string): Promise<void>;
  delete(key: string): Promise<void>;
}
