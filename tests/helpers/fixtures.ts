export function newId(): string {
  return crypto.randomUUID();
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@test.example.com`;
}
// A rank for a fixture row inserted straight into the database. Ordered by the
// notional position the test means, then by insertion order so two rows that
// share one still satisfy the unique index. Never ends in the zero digit, which
// the key generator rejects as a bound.
let rankCounter = 0;

export function rankKey(position = 1000): string {
  rankCounter += 1;
  const ordinal = Math.round(position) + 1_000_000;
  return `V0${String(ordinal).padStart(9, '0')}${String(rankCounter).padStart(5, '0')}1`;
}

// image_storage_key is nullable only because link attachments share the table.
// A row selected with kind = 'image' always carries one, so a null here is a
// broken fixture rather than a case to handle.
export function imageStorageKey(key: string | null): string {
  if (key === null) {
    throw new Error('image attachment row has no image_storage_key');
  }
  return key;
}

// Uploading an image is uploading a file: the server reads the leading bytes and
// decides. Kept here because most fixtures want a path, not a FormData.
export function imageUploadPath(taskId: string, filename = 'pixel.png', id?: string): string {
  const params = new URLSearchParams({ task_id: taskId, filename });
  if (id !== undefined) {
    params.set('id', id);
  }
  return `/api/attachments/files?${params.toString()}`;
}
