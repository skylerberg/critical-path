import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';

export const ME = 'u-me';

export function bulkTask(
  id: string,
  columnId = 'c1',
  position = 1000,
  extra: Partial<BoardTask> = {}
): BoardTask {
  return {
    id,
    column_id: columnId,
    title: id,
    description: null,
    sort_key: `V0${String(Math.round(position)).padStart(8, '0')}1`,
    position,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    attachment_count: 0,
    image_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    ...extra,
  };
}

// The signed-in user owns the project, because every set mutator no-ops on a
// board the user cannot edit.
export function seedBulkBoard(tasks: BoardTask[], selected: string[]): void {
  board.reset();
  selection.clear();
  session.user = {
    id: ME,
    name: 'Ada',
    email: 'ada@example.com',
    avatar_url: null,
    email_verified: false,
  };
  board.currentProjectId = 'p1';
  board.project = {
    id: 'p1',
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: ME,
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00Z',
  };
  board.columns = [
    { id: 'c1', name: 'Todo', position: 1000, sort_key: 'V0', is_done: false },
    { id: 'c2', name: 'Done', position: 2000, sort_key: 'V1', is_done: true },
  ];
  board.tasks = tasks;
  for (const id of selected) {
    selection.toggle(id);
  }
}
