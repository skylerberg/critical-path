import type { RealtimePayloads } from '../../src/services/realtime/payloads';
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

// The one upload path builder. Uploading an image is uploading a file — the
// server reads the leading bytes and decides — so there is nothing for a second
// image-specific version to do differently.
//
// Everything past the task id is named rather than positional on purpose: the
// two builders this replaced disagreed about what the third argument was, one
// reading it as a content type and the other as the row id, which is a mix-up
// that type-checks and uploads under the wrong id.
export function uploadPath(
  taskId: string,
  options: { filename?: string; contentType?: string; id?: string } = {}
): string {
  const params = new URLSearchParams({ task_id: taskId });
  if (options.filename !== undefined) params.set('filename', options.filename);
  if (options.contentType !== undefined) params.set('content_type', options.contentType);
  if (options.id !== undefined) params.set('id', options.id);
  return `/api/attachments/files?${params.toString()}`;
}

// Realtime payloads are typed per event type, so an envelope built in a test has
// to carry a whole valid payload even where the test only cares about routing.
// Typed against the payload map rather than restated, so a field added there
// fails here instead of leaving fixtures describing a shape nothing sends.
export function boardTaskPayload(
  id: string,
  overrides: Partial<RealtimePayloads['task_updated']> = {}
): RealtimePayloads['task_updated'] {
  return {
    id,
    column_id: newId(),
    title: 'Fixture task',
    description: null,
    sort_key: rankKey(),
    due_date: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    column_since: '2026-01-01T00:00:00.000Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    cover_image_url: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
    ...overrides,
  };
}

export function projectListPayload(id: string): RealtimePayloads['project_updated'] {
  return {
    id,
    name: 'Fixture project',
    description: '',
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
    open_task_count: 0,
    done_task_count: 0,
  };
}
