export type SniffedImageContentType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export function sniffImageContentType(data: Buffer): SniffedImageContentType | null {
  if (data.length >= 4 && PNG_MAGIC.every((byte, i) => data[i] === byte)) {
    return 'image/png';
  }

  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }

  const gifHeader = data.subarray(0, 6).toString('latin1');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return 'image/gif';
  }

  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}
