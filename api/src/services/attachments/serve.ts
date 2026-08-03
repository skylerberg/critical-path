const MAX_FILENAME_LENGTH = 255;
const MAX_CONTENT_TYPE_LENGTH = 127;
const FALLBACK_FILENAME = 'attachment';
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

const MIME_TOKEN = "[a-z0-9!#$%&'*+.^_`|~-]+";
const MIME_PATTERN = new RegExp(`^${MIME_TOKEN}/${MIME_TOKEN}$`);

function isControlCharacter(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

// Multipart filenames never pass through arktype, so this is the only thing
// standing between an attacker-chosen name and a Postgres text bind that
// refuses NUL — an unsanitised name would turn a bad request into a 500.
export function sanitizeUploadFilename(raw: string): string {
  const separator = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  const base = separator === -1 ? raw : raw.slice(separator + 1);

  let cleaned = '';
  for (const char of base) {
    const code = char.codePointAt(0) as number;
    if (isControlCharacter(code)) continue;
    if (char === '"' || char === '\\') continue;
    cleaned += char;
  }

  cleaned = cleaned.replace(/\s+/g, ' ').trim().slice(0, MAX_FILENAME_LENGTH).trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    return FALLBACK_FILENAME;
  }
  return cleaned;
}

// The declared type is metadata for the UI glyph and nothing else; it is never
// written to a response header, so anything unrecognisable degrades silently.
export function sanitizeDeclaredContentType(raw: string): string {
  const withoutParameters = raw.split(';')[0].trim().toLowerCase();
  if (withoutParameters.length === 0 || withoutParameters.length > MAX_CONTENT_TYPE_LENGTH) {
    return DEFAULT_CONTENT_TYPE;
  }
  return MIME_PATTERN.test(withoutParameters) ? withoutParameters : DEFAULT_CONTENT_TYPE;
}

// RFC 5987 attr-char excludes these even though encodeURIComponent leaves them.
function encodeExtValue(filename: string): string {
  return encodeURIComponent(filename).replace(
    /['()*!]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

// Node throws on an illegal header value, so a filename that reached the header
// unescaped would be a 500 rather than a download.
export function contentDispositionAttachment(filename: string): string {
  const safe = sanitizeUploadFilename(filename);
  let ascii = '';
  for (const char of safe) {
    const code = char.codePointAt(0) as number;
    ascii += code >= 0x20 && code <= 0x7e && char !== '"' && char !== '\\' ? char : '_';
  }
  if (ascii.trim() === '') {
    ascii = FALLBACK_FILENAME;
  }
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeExtValue(safe)}`;
}
