import { promisify } from 'node:util';
import { crc32, deflateRaw as deflateRawCallback } from 'node:zlib';

const deflateRaw = promisify(deflateRawCallback);

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const VERSION = 20;
const UTF8_NAMES_FLAG = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;

// This writer emits plain zip, not zip64, so every size and offset field is 32
// bits wide and the entry count is 16. Callers must refuse anything larger
// rather than let the fields wrap into a corrupt archive.
export const ZIP_MAX_BYTES = 0xffffffff;
export const ZIP_MAX_ENTRIES = 0xffff;

export interface ZipEntry {
  name: string;
  data: Buffer;
  deflate: boolean;
}

interface DirectoryRecord {
  name: Buffer;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

// Deflating incompressible input expands it: zlib's raw worst case is five
// bytes per 16 KiB stored block plus a six-byte trailer.
export function zipSizeUpperBound(entries: Array<{ name: string; size: number }>): number {
  let total = END_OF_CENTRAL_DIRECTORY_BYTES;
  for (const entry of entries) {
    const nameBytes = Buffer.byteLength(entry.name, 'utf8');
    total +=
      LOCAL_HEADER_BYTES +
      CENTRAL_HEADER_BYTES +
      2 * nameBytes +
      entry.size +
      5 * Math.ceil(entry.size / 16383) +
      6;
  }
  return total;
}

function dosDateTime(modified: Date): { time: number; date: number } {
  const year = Math.max(modified.getUTCFullYear(), 1980);
  return {
    time:
      (modified.getUTCHours() << 11) |
      (modified.getUTCMinutes() << 5) |
      (modified.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((modified.getUTCMonth() + 1) << 5) | modified.getUTCDate(),
  };
}

function localHeader(record: DirectoryRecord, time: number, date: number): Buffer {
  const header = Buffer.alloc(LOCAL_HEADER_BYTES + record.name.length);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(UTF8_NAMES_FLAG, 6);
  header.writeUInt16LE(record.method, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(record.crc, 14);
  header.writeUInt32LE(record.compressedSize, 18);
  header.writeUInt32LE(record.size, 22);
  header.writeUInt16LE(record.name.length, 26);
  header.writeUInt16LE(0, 28);
  record.name.copy(header, LOCAL_HEADER_BYTES);
  return header;
}

function centralHeader(record: DirectoryRecord, time: number, date: number): Buffer {
  const header = Buffer.alloc(CENTRAL_HEADER_BYTES + record.name.length);
  header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(VERSION, 6);
  header.writeUInt16LE(UTF8_NAMES_FLAG, 8);
  header.writeUInt16LE(record.method, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(record.crc, 16);
  header.writeUInt32LE(record.compressedSize, 20);
  header.writeUInt32LE(record.size, 24);
  header.writeUInt16LE(record.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(record.offset, 42);
  record.name.copy(header, CENTRAL_HEADER_BYTES);
  return header;
}

function endOfCentralDirectory(count: number, size: number, offset: number): Buffer {
  const end = Buffer.alloc(END_OF_CENTRAL_DIRECTORY_BYTES);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

async function* zipChunks(
  entries: AsyncIterable<ZipEntry>,
  modified: Date
): AsyncGenerator<Uint8Array> {
  const { time, date } = dosDateTime(modified);
  const directory: DirectoryRecord[] = [];
  let offset = 0;

  for await (const entry of entries) {
    const payload = entry.deflate ? await deflateRaw(entry.data) : entry.data;
    const record: DirectoryRecord = {
      name: Buffer.from(entry.name, 'utf8'),
      method: entry.deflate ? METHOD_DEFLATE : METHOD_STORE,
      crc: crc32(entry.data),
      compressedSize: payload.length,
      size: entry.data.length,
      offset,
    };
    directory.push(record);

    const header = localHeader(record, time, date);
    yield header;
    yield payload;
    offset += header.length + payload.length;
  }

  const directoryOffset = offset;
  let directorySize = 0;
  for (const record of directory) {
    const header = centralHeader(record, time, date);
    yield header;
    directorySize += header.length;
  }

  yield endOfCentralDirectory(directory.length, directorySize, directoryOffset);
}

export function zipStream(
  entries: AsyncIterable<ZipEntry>,
  modified: Date
): ReadableStream<Uint8Array> {
  return ReadableStream.from(zipChunks(entries, modified));
}
