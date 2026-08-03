import { describe, it, expect } from 'vitest';
import {
  contentDispositionAttachment,
  sanitizeDeclaredContentType,
  sanitizeUploadFilename,
} from '../../../src/services/attachments/serve';

describe('sanitizeUploadFilename', () => {
  it.each([
    ['plain.pdf', 'plain.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\evil\\x.exe', 'x.exe'],
    ['/absolute/path/report.docx', 'report.docx'],
    ['quote".pdf', 'quote.pdf'],
    ['back\\slash.pdf', 'slash.pdf'],
    ['semi;colon.pdf', 'semi;colon.pdf'],
    ['line\r\nbreak.pdf', 'linebreak.pdf'],
    ['nul\u0000byte.pdf', 'nulbyte.pdf'],
    ['c1\u0085control.pdf', 'c1control.pdf'],
    ['   spaced    out.pdf   ', 'spaced out.pdf'],
    ['🎉🎊.png', '🎉🎊.png'],
    ['', 'attachment'],
    ['\u0000\u0001', 'attachment'],
    ['.', 'attachment'],
    ['..', 'attachment'],
  ])('sanitizes %j', (input, expected) => {
    expect(sanitizeUploadFilename(input)).toBe(expected);
  });

  it('caps a very long name at 255 characters', () => {
    const result = sanitizeUploadFilename(`${'a'.repeat(400)}.pdf`);
    expect(result.length).toBe(255);
  });

  it('never keeps a control character', () => {
    const raw = Array.from({ length: 0xa0 }, (_, code) => String.fromCharCode(code)).join('');
    const result = sanitizeUploadFilename(`${raw}name.txt`);
    for (let i = 0; i < result.length; i++) {
      const code = result.charCodeAt(i);
      expect(code >= 0x20 && !(code >= 0x7f && code <= 0x9f)).toBe(true);
    }
  });
});

describe('sanitizeDeclaredContentType', () => {
  it.each([
    ['application/pdf', 'application/pdf'],
    ['APPLICATION/PDF', 'application/pdf'],
    ['text/html; charset=utf-8', 'text/html'],
    ['  image/svg+xml  ', 'image/svg+xml'],
    ['', 'application/octet-stream'],
    ['nonsense', 'application/octet-stream'],
    ['a/b/c', 'application/octet-stream'],
    ['text/html\r\nX-Evil: 1', 'application/octet-stream'],
    ['text/<script>', 'application/octet-stream'],
  ])('sanitizes %j', (input, expected) => {
    expect(sanitizeDeclaredContentType(input)).toBe(expected);
  });

  it('refuses an over-long type', () => {
    expect(sanitizeDeclaredContentType(`application/${'x'.repeat(200)}`)).toBe(
      'application/octet-stream'
    );
  });
});

describe('contentDispositionAttachment', () => {
  it('always starts with attachment and carries both filename forms', () => {
    const header = contentDispositionAttachment('report.pdf');
    expect(header).toBe(`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
  });

  it.each([
    'plain.pdf',
    'quote".pdf',
    'back\\slash.pdf',
    'semi;colon.pdf',
    'line\r\nbreak.pdf',
    'nul\u0000byte.pdf',
    '../../etc/passwd',
    'C:\\evil\\x.exe',
    `${'a'.repeat(400)}.pdf`,
    '🎉🎊.png',
    '',
    'répertoire (final)*!.txt',
  ])('produces a legal header value for %j', (name) => {
    const header = contentDispositionAttachment(name);
    expect(header.startsWith('attachment; ')).toBe(true);
    expect(header).not.toMatch(/[\r\n]/);

    const quoted = /filename="([^"]*)"/.exec(header);
    expect(quoted).not.toBeNull();
    expect(quoted?.[1]).not.toMatch(/["\\]/);

    const ext = /filename\*=UTF-8''(.*)$/.exec(header);
    expect(ext).not.toBeNull();
    expect(ext?.[1]).not.toMatch(/['()*!]/);
    expect(decodeURIComponent(ext?.[1] ?? '')).toBe(sanitizeUploadFilename(name));
  });

  it('replaces non-ASCII bytes in the quoted segment but keeps them in the ext-value', () => {
    const header = contentDispositionAttachment('naïve.txt');
    expect(header).toContain('filename="na_ve.txt"');
    expect(header).toContain(`filename*=UTF-8''na%C3%AFve.txt`);
  });

  it('falls back when every character is replaced', () => {
    const header = contentDispositionAttachment('日本語');
    expect(header).toContain('filename="___"');
    expect(decodeURIComponent(/filename\*=UTF-8''(.*)$/.exec(header)?.[1] ?? '')).toBe('日本語');
  });
});
