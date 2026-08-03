import { type } from 'arktype';
import { nullableTiptapDocSchema, type TiptapDoc } from './tiptap';

// One open object with optional keys rather than a union of the three payload
// shapes: arktype refuses an unordered union whose members overlap and include
// a morph (the Tiptap doc), and a union would also force every reader to narrow.
export const activityValueSchema = type({
  'text?': 'string',
  'id?': 'string',
  'name?': 'string',
  'doc?': nullableTiptapDocSchema,
});

export const nullableActivityValueSchema = activityValueSchema.or('null');

// One literal rather than a concatenation: arktype infers the union from the
// source text, and a built string collapses to `never`.
export const taskActivityKindSchema = type(
  "'created' | 'title_changed' | 'description_changed' | 'column_changed' | 'due_date_changed' | 'label_added' | 'label_removed' | 'assignee_added' | 'assignee_removed' | 'blocker_added' | 'blocker_removed' | 'archived' | 'restored' | 'checklist_item_added' | 'checklist_item_checked' | 'checklist_item_unchecked' | 'checklist_item_renamed' | 'checklist_item_removed' | 'checklist_item_promoted'"
);

export const taskActivitySchema = type({
  id: 'string',
  kind: taskActivityKindSchema,
  actor_user_id: 'string',
  old_value: nullableActivityValueSchema,
  new_value: nullableActivityValueSchema,
  created_at: 'string',
});

export const taskActivityResponseSchema = type({
  activity: taskActivitySchema.array(),
});

export type TaskActivityKind = typeof taskActivityKindSchema.infer;
export type TaskActivity = typeof taskActivitySchema.infer;

// Write-side shapes: the stored value is permissive enough to serve every kind,
// so these are what stop a call site from mixing two of them in one entry.
export interface ActivityTextValue {
  text: string;
}
export interface ActivityRefValue {
  id: string;
  name: string;
}
export interface ActivityDocValue {
  doc: TiptapDoc | null;
}
export type ActivityValue = ActivityTextValue | ActivityRefValue | ActivityDocValue;
