import type { BoardTask } from './board-types';
import type { Placement } from './ranks';

// The card as it looks before the server has said anything about it. Shared with
// the checklist sub-store, whose promote inserts one rather than waiting for the
// realtime echo: a card absent from `tasks` has no title to build a slug from.
export function optimisticTask(
  id: string,
  columnId: string,
  title: string,
  placement: Placement
): BoardTask {
  const now = new Date().toISOString();
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    sort_key: placement.sort_key,
    due_date: null,
    created_at: now,
    updated_at: now,
    column_since: now,
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    cover_image_url: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  };
}
