import { SHADOW_PLACEHOLDER_ITEM_ID } from 'svelte-dnd-action';

export type ProjectView = 'board' | 'graph';

// Alphanumeric, not base64url: a base64url alias can begin with '-', and an
// argument that begins with '-' is an option to every CLI parser there is, so
// `cpath project show <alias>` failed outright for 1 project in 64. Base62
// needs the same 22 characters for 128 bits (62^22 > 2^128), so the fix costs
// no length — only the bit-slicing, which base62 cannot use. Kept identical to
// the CLI's copy in critical-path-api/cli/src/short-links.ts.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const BASE = BigInt(ALPHABET.length);
const ALIAS_LENGTH = 22;
const UUID_MAX = 1n << 128n;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALIAS_RE = /^[A-Za-z0-9]{22}$/;
const SLUG_MAX_LENGTH = 60;

// Not '': a slugless canonical form would rewrite itself forever.
const EMPTY_SLUG = '-';

export function encodeId(uuid: string): string {
  if (!UUID_RE.test(uuid)) {
    throw new TypeError(`Not a UUID: ${uuid}`);
  }
  let value = BigInt(`0x${uuid.replace(/-/g, '')}`);
  // Fixed width rather than the shortest form: padding with the zero digit is
  // what keeps every alias 22 characters and the encoding a bijection.
  const digits = new Array<string>(ALIAS_LENGTH);
  for (let i = ALIAS_LENGTH - 1; i >= 0; i--) {
    digits[i] = ALPHABET[Number(value % BASE)]!;
    value /= BASE;
  }
  return digits.join('');
}

// 22 base62 characters address about eight times as many values as a uuid has,
// so a well-formed alias can still name nothing. That is the range check below,
// and it is the whole of canonicality here: fixed-width big-endian base62 gives
// each id exactly one spelling, unlike the base64url scheme this replaced,
// where four spare bits gave every id fifteen. Null rather than a throw: the
// input is untrusted URL text.
export function decodeId(alias: string): string | null {
  if (!ALIAS_RE.test(alias)) {
    return null;
  }
  let value = 0n;
  for (const character of alias) {
    value = value * BASE + BigInt(ALPHABET.indexOf(character));
  }
  if (value >= UUID_MAX) {
    return null;
  }
  const hex = value.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function slugify(title: string): string {
  const trimmed = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slug = trimmed.slice(0, SLUG_MAX_LENGTH).replace(/-+$/, '');
  return slug === '' ? EMPTY_SLUG : slug;
}

// A drag seeds a gap-filling placeholder into the item list under an id that names
// nothing, so any list drawing its items as links must skip building one for it:
// encoding it throws, and that throw lands mid-drag and kills the render the drag
// needs. Asking here rather than loosening the encoder keeps malformed ids fatal.
export function isDragPlaceholder(id: string): boolean {
  return id === SHADOW_PLACEHOLDER_ITEM_ID;
}

export function projectHref(projectId: string, name: string, view: ProjectView = 'board'): string {
  const base = `/p/${encodeId(projectId)}/${slugify(name)}`;
  return view === 'graph' ? `${base}/graph` : base;
}

export function taskHref(taskId: string, title: string, view: ProjectView = 'board'): string {
  const base = `/t/${encodeId(taskId)}/${slugify(title)}`;
  return view === 'graph' ? `${base}/graph` : base;
}

export function publicBoardHref(projectId: string): string {
  return `/public/projects/${encodeId(projectId)}`;
}

export function publicTaskHref(projectId: string, taskId: string): string {
  return `/public/projects/${encodeId(projectId)}/tasks/${encodeId(taskId)}`;
}
