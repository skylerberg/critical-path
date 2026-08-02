import { SHADOW_PLACEHOLDER_ITEM_ID } from 'svelte-dnd-action';

export type ProjectView = 'board' | 'graph';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALIAS_RE = /^[A-Za-z0-9_-]{22}$/;
const SLUG_MAX_LENGTH = 60;

// Not '': a slugless canonical form would rewrite itself forever.
const EMPTY_SLUG = '-';

export function encodeId(uuid: string): string {
  if (!UUID_RE.test(uuid)) {
    throw new TypeError(`Not a UUID: ${uuid}`);
  }
  const hex = uuid.replace(/-/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < 32; i += 2) {
    bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  let out = '';
  for (let i = 0; i < 15; i += 3) {
    const group = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      ALPHABET[(group >> 18) & 63]! +
      ALPHABET[(group >> 12) & 63]! +
      ALPHABET[(group >> 6) & 63]! +
      ALPHABET[group & 63]!;
  }
  const last = bytes[15]!;
  return out + ALPHABET[last >> 2]! + ALPHABET[(last & 3) << 4]!;
}

// 22 base64 characters carry four more bits than a uuid, so every alias has 15
// non-canonical spellings that a general-purpose decoder accepts. The re-encode
// comparison is what rejects them. Null rather than a throw: the input is
// untrusted URL text.
export function decodeId(alias: string): string | null {
  if (!ALIAS_RE.test(alias)) {
    return null;
  }
  const bytes: number[] = [];
  for (let i = 0; i < 20; i += 4) {
    const group =
      (ALPHABET.indexOf(alias[i]!) << 18) |
      (ALPHABET.indexOf(alias[i + 1]!) << 12) |
      (ALPHABET.indexOf(alias[i + 2]!) << 6) |
      ALPHABET.indexOf(alias[i + 3]!);
    bytes.push((group >> 16) & 255, (group >> 8) & 255, group & 255);
  }
  bytes.push((ALPHABET.indexOf(alias[20]!) << 2) | (ALPHABET.indexOf(alias[21]!) >> 4));
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return encodeId(uuid) === alias ? uuid : null;
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
