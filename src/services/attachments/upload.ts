import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { storage } from '../storage/index';
import { logger } from '../../utils/logger';

export class UploadCapExceededError extends Error {
  constructor() {
    super('Upload exceeded its byte cap');
  }
}

export interface StoredUpload {
  storageKey: string;
  size: number;
}

// Swallows its own failure: every caller is already unwinding a failed upload,
// and a reclaim error would replace the response the client needs to see.
export async function discardStoredUpload(storageKey: string): Promise<void> {
  try {
    await storage.delete(storageKey);
  } catch (err) {
    logger.error({
      msg: 'Failed to reclaim a partial attachment object',
      storageKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// The cap is enforced on the bytes in flight, so an oversized upload is cut off
// mid-transfer and the request never holds more than a chunk.
export async function storeUploadStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  contentType: string
): Promise<StoredUpload> {
  const storageKey = crypto.randomUUID();
  const source = Readable.fromWeb(body as NodeReadableStream<Uint8Array>);

  let size = 0;
  const capped = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) {
        callback(new UploadCapExceededError());
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await storage.putStream(storageKey, source.pipe(capped), contentType);
  } catch (err) {
    source.destroy();
    await discardStoredUpload(storageKey);
    throw err;
  }

  return { storageKey, size };
}
