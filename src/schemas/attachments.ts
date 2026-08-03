import { type } from 'arktype';
import { optionalText, uuid } from './common';

export const ATTACHMENT_TITLE_MAX_LENGTH = 300;
export const ATTACHMENT_DESCRIPTION_MAX_LENGTH = 1000;
export const ATTACHMENT_URL_MAX_LENGTH = 2048;

function hasControlCharacter(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

// The storage gate, not the SSRF gate: its job is to guarantee that nothing
// which could become a javascript: or data: href ever reaches the database.
// Whether a stored URL may be *fetched* is decided later, by the unfurl policy.
export const attachmentLinkUrl = type('string').pipe((s, ctx) => {
  const trimmed = s.trim();
  if (trimmed.length === 0) {
    return ctx.error('a link');
  }
  if (trimmed.length > ATTACHMENT_URL_MAX_LENGTH) {
    return ctx.error(`at most ${ATTACHMENT_URL_MAX_LENGTH} characters`);
  }
  if (hasControlCharacter(trimmed)) {
    return ctx.error('free of control characters');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return ctx.error('a valid absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return ctx.error('a link starting with http:// or https://');
  }
  if (url.username !== '' || url.password !== '') {
    return ctx.error('a link without embedded credentials');
  }
  const normalized = url.toString();
  if (normalized.length > ATTACHMENT_URL_MAX_LENGTH) {
    return ctx.error(`at most ${ATTACHMENT_URL_MAX_LENGTH} characters`);
  }
  return normalized;
});

// The bytes are the whole request body, so the metadata travels as query
// parameters. The two text bounds are loose on purpose: both values are
// sanitised again by the serve helpers before they are stored or sent.
export const uploadAttachmentQuerySchema = type({
  task_id: uuid,
  'id?': uuid,
  'filename?': 'string <= 1024',
  'content_type?': 'string <= 1024',
});

export const createLinkAttachmentSchema = type({
  id: uuid,
  task_id: uuid,
  url: attachmentLinkUrl,
  'title?': optionalText(ATTACHMENT_TITLE_MAX_LENGTH),
});

export const patchAttachmentSchema = type({
  'title?': optionalText(ATTACHMENT_TITLE_MAX_LENGTH),
  'description?': optionalText(ATTACHMENT_DESCRIPTION_MAX_LENGTH),
});

// One open object with nullable per-kind keys rather than a two-member union:
// arktype refuses an unordered union whose members overlap, and every reader
// narrows on `kind` alone.
export const attachmentSchema = type({
  id: 'string',
  task_id: 'string',
  kind: "'file' | 'link'",
  title: 'string | null',
  description: 'string | null',
  filename: 'string | null',
  content_type: 'string | null',
  size_bytes: 'number | null',
  url: 'string | null',
  preview_url: 'string | null',
  favicon_url: 'string | null',
  unfurl_state: "'pending' | 'ok' | 'failed' | null",
  created_at: 'string',
  updated_at: 'string',
});

export type AttachmentResponse = typeof attachmentSchema.infer;
