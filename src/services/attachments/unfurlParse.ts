import {
  ATTACHMENT_DESCRIPTION_MAX_LENGTH,
  ATTACHMENT_TITLE_MAX_LENGTH,
} from '../../schemas/attachments';

export interface HeadMetadata {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  iconUrl: string | null;
}

const MAX_HEAD_BYTES = 128 * 1024;
const CHARSET_SCAN_BYTES = 4 * 1024;

// No HTML parser dependency: this is the one path in the product that eats
// attacker-controlled bytes, and four fields do not justify the supply-chain
// surface. Every pattern below is bounded and anchored so a crafted document
// cannot make the scan superlinear.
// Well above the longest value that survives trimming, so an over-long field is
// truncated rather than making its whole tag unmatchable and silently lost.
const TAG_PATTERN = /<(meta|title|link)\b([^>]{0,16000})>/gi;
const ATTRIBUTE_PATTERN =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]{0,60})\s*=\s*("[^"]{0,16000}"|'[^']{0,16000}'|[^\s"'>]{0,16000})/g;
const TITLE_TEXT_PATTERN = /<title\b[^>]{0,16000}>([\s\S]{0,16000}?)<\/title\s*>/i;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]{1,6}|[a-zA-Z]{2,10});/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body.startsWith('#x') || body.startsWith('#X')
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function clean(value: string | null, max: number): string | null {
  if (value === null) return null;
  let text = '';
  for (const char of decodeEntities(value)) {
    const code = char.codePointAt(0) as number;
    text += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : char;
  }
  text = text.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return text === '' ? null : text;
}

function unquote(raw: string): string {
  const first = raw[0];
  return first === '"' || first === "'" ? raw.slice(1, -1) : raw;
}

function attributes(raw: string): Map<string, string> {
  const found = new Map<string, string>();
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    if (!found.has(name)) {
      found.set(name, unquote(match[2]));
    }
  }
  return found;
}

function headSlice(body: Buffer): Buffer {
  const bounded = body.subarray(0, MAX_HEAD_BYTES);
  const end = bounded.indexOf('</head', 0, 'latin1');
  return end === -1 ? bounded : bounded.subarray(0, end);
}

function charsetFrom(contentTypeHeader: string, head: Buffer): string {
  const fromHeader = /charset\s*=\s*"?([a-zA-Z0-9_:.-]{1,40})/i.exec(contentTypeHeader);
  if (fromHeader) return fromHeader[1];
  const prefix = head.subarray(0, CHARSET_SCAN_BYTES).toString('latin1');
  const fromMeta = /<meta[^>]{0,500}charset\s*=\s*["']?([a-zA-Z0-9_:.-]{1,40})/i.exec(prefix);
  return fromMeta ? fromMeta[1] : 'utf-8';
}

function decodeHead(head: Buffer, contentTypeHeader: string): string {
  const label = charsetFrom(contentTypeHeader, head);
  try {
    return new TextDecoder(label).decode(head);
  } catch {
    return new TextDecoder('utf-8').decode(head);
  }
}

// Rejects data: and every other scheme by construction: a preview src that is
// not fetchable over http(s) is not a preview we can store.
function resolveHttpUrl(raw: string | null, base: string): string | null {
  if (raw === null) return null;
  const trimmed = decodeEntities(raw).trim();
  if (trimmed === '') return null;
  try {
    const resolved = new URL(trimmed, base);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

const ICON_RELS = new Set([
  'icon',
  'shortcut icon',
  'apple-touch-icon',
  'apple-touch-icon-precomposed',
  'fluid-icon',
  'mask-icon',
]);

export function parseHeadMetadata(
  body: Buffer,
  contentTypeHeader: string,
  finalUrl: string
): HeadMetadata {
  const head = headSlice(body);
  const text = decodeHead(head, contentTypeHeader);

  let ogTitle: string | null = null;
  let twitterTitle: string | null = null;
  let ogDescription: string | null = null;
  let metaDescription: string | null = null;
  let ogImage: string | null = null;
  let twitterImage: string | null = null;
  let iconHref: string | null = null;

  TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_PATTERN.exec(text)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = attributes(match[2]);

    if (tag === 'meta') {
      const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
      const content = attrs.get('content') ?? null;
      if (content === null) continue;
      if (key === 'og:title') ogTitle ??= content;
      else if (key === 'twitter:title') twitterTitle ??= content;
      else if (key === 'og:description') ogDescription ??= content;
      else if (key === 'description') metaDescription ??= content;
      else if (key === 'og:image' || key === 'og:image:url' || key === 'og:image:secure_url')
        ogImage ??= content;
      else if (key === 'twitter:image') twitterImage ??= content;
      continue;
    }

    if (tag === 'link') {
      const rel = (attrs.get('rel') ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
      const href = attrs.get('href');
      if (href !== undefined && ICON_RELS.has(rel)) {
        iconHref ??= href;
      }
    }
  }

  const titleTag = TITLE_TEXT_PATTERN.exec(text);

  return {
    title: clean(ogTitle ?? twitterTitle ?? titleTag?.[1] ?? null, ATTACHMENT_TITLE_MAX_LENGTH),
    description: clean(ogDescription ?? metaDescription ?? null, ATTACHMENT_DESCRIPTION_MAX_LENGTH),
    imageUrl: resolveHttpUrl(ogImage ?? twitterImage, finalUrl),
    iconUrl: resolveHttpUrl(iconHref, finalUrl),
  };
}
