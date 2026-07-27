import { describe, it, expect } from 'vitest';
import { imageArchivePath } from '../../../src/services/export/payload';

describe('imageArchivePath', () => {
  it('maps every content type the uploader accepts to its usual extension', () => {
    expect(imageArchivePath('i1', 'image/png')).toBe('images/i1.png');
    expect(imageArchivePath('i1', 'image/jpeg')).toBe('images/i1.jpg');
    expect(imageArchivePath('i1', 'image/gif')).toBe('images/i1.gif');
    expect(imageArchivePath('i1', 'image/webp')).toBe('images/i1.webp');
  });

  it('falls back to bin for a content type it does not know', () => {
    expect(imageArchivePath('i1', 'image/avif')).toBe('images/i1.bin');
    expect(imageArchivePath('i1', '')).toBe('images/i1.bin');
  });
});
