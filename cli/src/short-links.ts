// Alphanumeric, not base64url, because an alias beginning with '-' is an option
// to every CLI parser there is and `cpath project show <alias>` failed outright
// for 1 project in 64. Why base62 costs no length, and what the fixed width
// buys, is recorded once in web/src/lib/short-links.ts; this file is kept
// identical to it.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const BASE = BigInt(ALPHABET.length);
const ALIAS_LENGTH = 22;
const UUID_MAX = 1n << 128n;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALIAS_RE = /^[A-Za-z0-9]{22}$/;
const SLUG_MAX_LENGTH = 60;

// Not '': a slugless canonical form would rewrite itself forever in the browser.
const EMPTY_SLUG = '-';

export function encodeId(uuid: string): string {
  if (!UUID_RE.test(uuid)) {
    throw new TypeError(`Not a UUID: ${uuid}`);
  }
  let value = BigInt(`0x${uuid.replace(/-/g, '')}`);
  // Fixed width rather than the shortest form, for the reason the web copy
  // records.
  const digits = new Array<string>(ALIAS_LENGTH);
  for (let i = ALIAS_LENGTH - 1; i >= 0; i--) {
    digits[i] = ALPHABET[Number(value % BASE)];
    value /= BASE;
  }
  return digits.join('');
}

// 22 base62 characters address more values than a uuid has, so a well-formed
// alias can still name nothing; the range check below is the whole of
// canonicality. Null rather than a throw: this runs on whatever the user typed.
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

export function taskUrl(webUrl: string, taskId: string, title: string): string {
  return `${webUrl}/t/${encodeId(taskId)}/${slugify(title)}`;
}
