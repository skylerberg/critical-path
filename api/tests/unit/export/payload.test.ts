import { describe, it, expect } from 'vitest';
import { attachmentArchivePath, imageArchivePath } from '../../../src/services/export/payload';

describe('imageArchivePath', () => {
  it('maps every content type the uploader accepts to its usual extension', () => {
    expect(imageArchivePath('i1', 'image/png')).toBe('attachments/i1.png');
    expect(imageArchivePath('i1', 'image/jpeg')).toBe('attachments/i1.jpg');
    expect(imageArchivePath('i1', 'image/gif')).toBe('attachments/i1.gif');
    expect(imageArchivePath('i1', 'image/webp')).toBe('attachments/i1.webp');
  });

  it('falls back to bin for a content type it does not know', () => {
    expect(imageArchivePath('i1', 'image/avif')).toBe('attachments/i1.bin');
    expect(imageArchivePath('i1', '')).toBe('attachments/i1.bin');
  });
});

describe('attachmentArchivePath', () => {
  it('keeps a plain extension and always bases the name on the id', () => {
    expect(attachmentArchivePath('a1', 'spec.pdf')).toBe('attachments/a1.pdf');
    expect(attachmentArchivePath('a1', 'ARCHIVE.ZIP')).toBe('attachments/a1.zip');
    expect(attachmentArchivePath('a1', 'notes.tar.gz')).toBe('attachments/a1.gz');
  });

  it('never lets a filename introduce a path', () => {
    expect(attachmentArchivePath('a1', '../../evil.sh')).toBe('attachments/a1.sh');
    expect(attachmentArchivePath('a1', '/etc/passwd')).toBe('attachments/a1.bin');
  });

  it('falls back to bin for anything that is not a short alphanumeric extension', () => {
    expect(attachmentArchivePath('a1', 'LICENSE')).toBe('attachments/a1.bin');
    expect(attachmentArchivePath('a1', 'x.')).toBe('attachments/a1.bin');
    expect(attachmentArchivePath('a1', 'x.verylongextension')).toBe('attachments/a1.bin');
    expect(attachmentArchivePath('a1', 'x.p df')).toBe('attachments/a1.bin');
    expect(attachmentArchivePath('a1', 'x.p/d')).toBe('attachments/a1.bin');
    expect(attachmentArchivePath('a1', '')).toBe('attachments/a1.bin');
  });
});
