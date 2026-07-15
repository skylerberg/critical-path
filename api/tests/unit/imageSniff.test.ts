import { describe, it, expect } from 'vitest';
import { sniffImageContentType } from '../../src/services/imageSniff';

describe('sniffImageContentType', () => {
  it('detects PNG from the 89 50 4E 47 magic', () => {
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffImageContentType(data)).toBe('image/png');
  });

  it('detects JPEG from the FF D8 FF magic', () => {
    const data = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffImageContentType(data)).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    const data = Buffer.concat([Buffer.from('GIF87a', 'latin1'), Buffer.from([0x01, 0x00])]);
    expect(sniffImageContentType(data)).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    const data = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([0x01, 0x00])]);
    expect(sniffImageContentType(data)).toBe('image/gif');
  });

  it('detects WebP from RIFF plus the WEBP fourCC', () => {
    const data = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x1a, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP', 'latin1'),
      Buffer.from('VP8L', 'latin1'),
    ]);
    expect(sniffImageContentType(data)).toBe('image/webp');
  });

  it('rejects RIFF containers that are not WebP', () => {
    const data = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'latin1'),
      Buffer.from('fmt ', 'latin1'),
    ]);
    expect(sniffImageContentType(data)).toBeNull();
  });

  it('rejects a RIFF header truncated before the fourCC', () => {
    const data = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x1a, 0x00, 0x00, 0x00]),
      Buffer.from('WE', 'latin1'),
    ]);
    expect(sniffImageContentType(data)).toBeNull();
  });

  it('rejects arbitrary bytes', () => {
    expect(sniffImageContentType(Buffer.from('hello world'))).toBeNull();
    expect(sniffImageContentType(Buffer.from('<html><body>hi</body></html>'))).toBeNull();
  });

  it('rejects empty and truncated inputs', () => {
    expect(sniffImageContentType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageContentType(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffImageContentType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageContentType(Buffer.from('GIF89', 'latin1'))).toBeNull();
  });

  it('rejects JPEG-like prefixes that break before the third byte', () => {
    expect(sniffImageContentType(Buffer.from([0xff, 0xd8, 0xfe, 0x00]))).toBeNull();
  });
});
