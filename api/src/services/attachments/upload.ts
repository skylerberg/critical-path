import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { storage } from '../storage/index';
import { sniffImageContentType, type SniffedImageContentType } from '../imageSniff';
import { logger } from '../../utils/logger';

export class UploadCapExceededError extends Error {
  constructor() {
    super('Upload exceeded its byte cap');
  }
}

interface StoredUpload {
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

// Every format sniffImageContentType recognises declares itself within twelve
// bytes, so that is all the prefix this has to hold to decide what is arriving.
const SNIFF_BYTES = 12;

export interface SniffedUpload extends StoredUpload {
  imageContentType: SniffedImageContentType | null;
}

// Pulls through the iterator by hand rather than `for await`, which would call
// return() on the way out of the loop and destroy the stream with the body
// still unread.
async function peek(
  iterator: AsyncIterator<Buffer>,
  wanted: number
): Promise<{ prefix: Buffer; ended: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < wanted) {
    const next = await iterator.next();
    if (next.done === true) {
      return { prefix: Buffer.concat(chunks), ended: true };
    }
    chunks.push(next.value);
    total += next.value.length;
  }
  return { prefix: Buffer.concat(chunks), ended: false };
}

// Reads enough of the body to tell an image from anything else, then stores it
// under whichever cap that answer implies. The decision is the server's: a
// client sends bytes and is told what they turned out to be, so every client
// gets the same answer without implementing the rule.
export async function storeSniffedUpload(
  body: ReadableStream<Uint8Array>,
  caps: { image: number; file: number },
  fallbackContentType: string
): Promise<SniffedUpload> {
  const source = Readable.fromWeb(body as NodeReadableStream<Uint8Array>);
  const iterator = source[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  const { prefix, ended } = await peek(iterator, SNIFF_BYTES);

  const imageContentType = sniffImageContentType(prefix);
  const maxBytes = imageContentType === null ? caps.file : caps.image;

  const rejoined = Readable.from(
    (async function* () {
      if (prefix.length > 0) {
        yield prefix;
      }
      if (!ended) {
        while (true) {
          const next = await iterator.next();
          if (next.done === true) break;
          yield next.value;
        }
      }
    })()
  );

  const stored = await pipeToStorage(
    rejoined,
    maxBytes,
    imageContentType ?? fallbackContentType,
    source
  );
  return { ...stored, imageContentType };
}

// The cap is enforced on the bytes in flight, so an oversized upload is cut off
// mid-transfer and the request never holds more than a chunk.
async function pipeToStorage(
  data: Readable,
  maxBytes: number,
  contentType: string,
  abortOnFailure: Readable
): Promise<StoredUpload> {
  const storageKey = crypto.randomUUID();

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
    await storage.putStream(storageKey, data.pipe(capped), contentType);
  } catch (err) {
    abortOnFailure.destroy();
    await discardStoredUpload(storageKey);
    throw err;
  }

  return { storageKey, size };
}
