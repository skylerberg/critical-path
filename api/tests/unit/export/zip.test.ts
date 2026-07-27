import { randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import {
  zipStream,
  zipSizeUpperBound,
  ZIP_MAX_BYTES,
  type ZipEntry,
} from '../../../src/services/export/zip';

const MODIFIED = new Date('2026-07-26T13:45:30.000Z');

async function* iterate(entries: ZipEntry[]): AsyncGenerator<ZipEntry> {
  for (const entry of entries) {
    yield entry;
  }
}

async function build(entries: ZipEntry[], modified = MODIFIED): Promise<Buffer> {
  const buffer = await new Response(zipStream(iterate(entries), modified)).arrayBuffer();
  return Buffer.from(buffer);
}

describe('zipStream', () => {
  it('round-trips deflated, stored, nested and non-ASCII entries through an independent reader', async () => {
    const text = Buffer.from('hello '.repeat(500), 'utf8');
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x7f, 0x80]);
    const unicode = Buffer.from('naïve café 🎉', 'utf8');

    const archive = await build([
      { name: 'project.json', data: text, deflate: true },
      { name: 'images/pixel.png', data: binary, deflate: false },
      { name: 'images/café-🎉.txt', data: unicode, deflate: false },
    ]);

    const files = unzipSync(new Uint8Array(archive));
    expect(Object.keys(files)).toEqual(['project.json', 'images/pixel.png', 'images/café-🎉.txt']);
    expect(Buffer.from(files['project.json'])).toEqual(text);
    expect(Buffer.from(files['images/pixel.png'])).toEqual(binary);
    expect(Buffer.from(files['images/café-🎉.txt'])).toEqual(unicode);
  });

  it('actually compresses the entries it is told to deflate', async () => {
    const text = Buffer.from('a'.repeat(50_000), 'utf8');
    const deflated = await build([{ name: 'a.txt', data: text, deflate: true }]);
    const stored = await build([{ name: 'a.txt', data: text, deflate: false }]);

    expect(deflated.length).toBeLessThan(stored.length / 10);
    expect(Buffer.from(unzipSync(new Uint8Array(deflated))['a.txt'])).toEqual(text);
  });

  it('produces an EOCD-only archive for zero entries', async () => {
    const archive = await build([]);
    expect(archive.length).toBe(22);
    expect(unzipSync(new Uint8Array(archive))).toEqual({});
  });

  it('round-trips a 1 MiB incompressible stored entry', async () => {
    const data = randomBytes(1024 * 1024);
    const archive = await build([{ name: 'big.bin', data, deflate: false }]);

    const files = unzipSync(new Uint8Array(archive));
    expect(Buffer.from(files['big.bin'])).toEqual(data);
  });

  it('writes an empty entry that reads back as empty', async () => {
    const archive = await build([{ name: 'empty.txt', data: Buffer.alloc(0), deflate: true }]);
    const files = unzipSync(new Uint8Array(archive));
    expect(Object.keys(files)).toEqual(['empty.txt']);
    expect(files['empty.txt'].length).toBe(0);
  });

  it('records the DOS timestamp derived from the modified date', async () => {
    const archive = await build([{ name: 'a.txt', data: Buffer.from('a'), deflate: false }]);
    const expectedTime = (13 << 11) | (45 << 5) | (30 >> 1);
    const expectedDate = ((2026 - 1980) << 9) | (7 << 5) | 26;

    expect(archive.readUInt16LE(10)).toBe(expectedTime);
    expect(archive.readUInt16LE(12)).toBe(expectedDate);
  });

  it('clamps pre-1980 dates the DOS field cannot represent', async () => {
    const archive = await build(
      [{ name: 'a.txt', data: Buffer.from('a'), deflate: false }],
      new Date('1970-01-01T00:00:00.000Z')
    );
    expect(archive.readUInt16LE(12) >> 9).toBe(0);
    expect(unzipSync(new Uint8Array(archive))['a.txt'].length).toBe(1);
  });

  it('streams entries lazily rather than draining them up front', async () => {
    const pulled: string[] = [];
    async function* tracked(): AsyncGenerator<ZipEntry> {
      for (const name of ['a.txt', 'b.txt', 'c.txt']) {
        pulled.push(name);
        yield { name, data: Buffer.from(name), deflate: false };
      }
    }

    const stream = zipStream(tracked(), MODIFIED);
    const reader = stream.getReader();
    await reader.read();
    expect(pulled).toEqual(['a.txt']);

    await reader.cancel();
  });
});

describe('zipSizeUpperBound', () => {
  it('bounds a real archive from above', async () => {
    const entries: ZipEntry[] = [
      { name: 'project.json', data: Buffer.from('x'.repeat(4000), 'utf8'), deflate: true },
      { name: 'images/a.png', data: randomBytes(9000), deflate: false },
    ];
    const archive = await build(entries);
    const bound = zipSizeUpperBound(entries.map((e) => ({ name: e.name, size: e.data.length })));

    expect(bound).toBeGreaterThanOrEqual(archive.length);
  });

  it('bounds an incompressible deflated entry from above', async () => {
    const data = randomBytes(200_000);
    const archive = await build([{ name: 'noise.bin', data, deflate: true }]);
    const bound = zipSizeUpperBound([{ name: 'noise.bin', size: data.length }]);

    expect(archive.length).toBeGreaterThan(data.length);
    expect(bound).toBeGreaterThanOrEqual(archive.length);
  });

  it('crosses the 32-bit ceiling once the entries do', () => {
    expect(zipSizeUpperBound([{ name: 'a', size: 4_000_000_000 }])).toBeLessThan(ZIP_MAX_BYTES);
    expect(zipSizeUpperBound([{ name: 'a', size: 4_294_000_000 }])).toBeGreaterThan(ZIP_MAX_BYTES);
  });
});
