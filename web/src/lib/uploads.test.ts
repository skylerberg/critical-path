import { describe, expect, it } from 'vitest';
import { uploadsAsImage } from './uploads';

function file(type: string, bytes = 1): File {
  const blob = new File([new Uint8Array(bytes)], 'upload', { type });
  return blob;
}

describe('uploadsAsImage', () => {
  it('claims the four formats the image endpoint sniffs for', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(uploadsAsImage(file(type))).toBe(true);
    }
  });

  it('leaves image types the endpoint would refuse to the attachment path', () => {
    for (const type of ['image/svg+xml', 'image/avif', 'image/heic', 'image/bmp']) {
      expect(uploadsAsImage(file(type))).toBe(false);
    }
  });

  it('leaves everything that is not an image to the attachment path', () => {
    for (const type of ['application/pdf', 'text/plain', 'video/mp4', '']) {
      expect(uploadsAsImage(file(type))).toBe(false);
    }
  });

  it('sends a PNG past the 10 MB image cap down the attachment path instead of failing it', () => {
    expect(uploadsAsImage(file('image/png', 10 * 1024 * 1024))).toBe(true);
    expect(uploadsAsImage(file('image/png', 10 * 1024 * 1024 + 1))).toBe(false);
  });
});
