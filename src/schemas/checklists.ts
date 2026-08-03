import { type } from 'arktype';
import { finiteNumber, stringWithLength, uuid } from './common';

// Must stay equal to the task title maximum: promoting an item writes its text
// into a title by direct insert, past that schema, and the column has no length
// CHECK. Restated rather than imported — the module holding it imports this one,
// and arktype resolves that cycle to undefined at load.
export const CHECKLIST_ITEM_TEXT_MIN_LENGTH = 1;
export const CHECKLIST_ITEM_TEXT_MAX_LENGTH = 2000;

const checklistItemText = stringWithLength(
  CHECKLIST_ITEM_TEXT_MIN_LENGTH,
  CHECKLIST_ITEM_TEXT_MAX_LENGTH
);

export const createChecklistItemSchema = type({
  id: uuid,
  task_id: uuid,
  text: checklistItemText,
  position: finiteNumber,
  'checked?': 'boolean',
});

export const patchChecklistItemSchema = type({
  'text?': checklistItemText,
  'checked?': 'boolean',
  'position?': finiteNumber,
});

export const checklistItemSchema = type({
  id: 'string',
  task_id: 'string',
  text: 'string',
  checked: 'boolean',
  position: finiteNumber,
  created_at: 'string',
  updated_at: 'string',
});

export type ChecklistItemResponse = typeof checklistItemSchema.infer;
