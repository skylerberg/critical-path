import { type } from 'arktype';
import { boundedUuidArray, calendarDate, stringWithLength, uuid } from './common';
import { nullableTiptapDocSchema } from './tiptap';

export const MAX_SERIES_PER_PROJECT = 50;
export const MAX_SERIES_CHECKLIST_ITEMS = 100;
export const MAX_TIMEZONE_LENGTH = 100;
// Must stay equal to the task title maximum: materializing a card writes this
// text straight into a title by direct insert, past that schema, and the column
// has no length CHECK.
export const SERIES_TITLE_MAX_LENGTH = 2000;
export const SERIES_RRULE_MAX_LENGTH = 500;

const seriesTitle = stringWithLength(1, SERIES_TITLE_MAX_LENGTH);

// Module-local so it never enters the OpenAPI schema-name registry.
const checklistItemInputs = (max: number) =>
  type({
    text: stringWithLength(1, SERIES_TITLE_MAX_LENGTH),
  })
    .array()
    .pipe((items, ctx) => {
      if (items.length > max) {
        return ctx.error(`at most ${max} items`);
      }
      return items;
    });

export const recurrencePresetSchema = type(
  "'daily' | 'weekdays' | 'weekly' | 'monthly_date' | 'monthly_weekday' | 'yearly'"
);

export const createTaskSeriesSchema = type({
  id: uuid,
  project_id: uuid,
  column_id: uuid,
  title: seriesTitle,
  'description?': nullableTiptapDocSchema,
  'due_date?': calendarDate.or('null'),
  'preset?': recurrencePresetSchema,
  'rrule?': stringWithLength(1, SERIES_RRULE_MAX_LENGTH),
  start_date: calendarDate,
  timezone: stringWithLength(1, MAX_TIMEZONE_LENGTH),
  'label_ids?': boundedUuidArray(100),
  'assignee_ids?': boundedUuidArray(100),
  'checklist_items?': checklistItemInputs(MAX_SERIES_CHECKLIST_ITEMS),
});

// Recurrence only: every other template field is copied from the card, which is
// what lets a card start repeating without restating itself.
export const createSeriesFromTaskSchema = type({
  id: uuid,
  'preset?': recurrencePresetSchema,
  'rrule?': stringWithLength(1, SERIES_RRULE_MAX_LENGTH),
  start_date: calendarDate,
  timezone: stringWithLength(1, MAX_TIMEZONE_LENGTH),
});

export const patchTaskSeriesSchema = type({
  'column_id?': uuid,
  'title?': seriesTitle,
  'description?': nullableTiptapDocSchema,
  'due_date?': calendarDate.or('null'),
  'preset?': recurrencePresetSchema,
  'rrule?': stringWithLength(1, SERIES_RRULE_MAX_LENGTH),
  'start_date?': calendarDate,
  'timezone?': stringWithLength(1, MAX_TIMEZONE_LENGTH),
  // 'ended' is server-set on rule exhaustion; ending a series from a client is
  // a delete.
  'status?': "'active' | 'paused'",
  'clear_missed?': 'boolean',
  'label_ids?': boundedUuidArray(100),
  'assignee_ids?': boundedUuidArray(100),
  'checklist_items?': checklistItemInputs(MAX_SERIES_CHECKLIST_ITEMS),
});

// What an open card needs to name its recurrence and change it: the rule as
// English, plus the two fields a preset menu is built from. Deliberately not the
// whole series — the template's labels, assignees and checklist belong to the
// series panel, and a card that restated them would be a second copy to keep
// honest.
export const taskSeriesRefSchema = type({
  id: 'string',
  summary: 'string',
  preset: recurrencePresetSchema.or('null'),
  start_date: 'string',
});

export const taskSeriesChecklistItemSchema = type({
  id: 'string',
  text: 'string',
});

export const taskSeriesSchema = type({
  id: 'string',
  project_id: 'string',
  column_id: 'string | null',
  title: 'string',
  description: nullableTiptapDocSchema,
  due_date: 'string | null',
  rrule: 'string',
  preset: recurrencePresetSchema.or('null'),
  summary: 'string',
  start_date: 'string',
  timezone: 'string',
  status: "'active' | 'paused' | 'ended'",
  next_occurrence_date: 'string | null',
  last_occurrence_date: 'string | null',
  missed_occurrence_count: 'number',
  last_missed_date: 'string | null',
  open_occurrence_count: 'number',
  last_error: 'string | null',
  ended_at: 'string | null',
  created_by: 'string | null',
  created_at: 'string',
  updated_at: 'string',
  label_ids: 'string[]',
  assignee_ids: 'string[]',
  checklist_items: taskSeriesChecklistItemSchema.array(),
});

export const taskSeriesCreateResponseSchema = taskSeriesSchema.merge({
  dropped_image_count: 'number',
});

export const taskSeriesListResponseSchema = type({
  series: taskSeriesSchema.array(),
});

export type TaskSeriesResponse = typeof taskSeriesSchema.infer;
export type TaskSeriesRef = typeof taskSeriesRefSchema.infer;
export type TaskSeriesCreateResponse = typeof taskSeriesCreateResponseSchema.infer;
export type CreateTaskSeriesInput = typeof createTaskSeriesSchema.infer;
export type CreateSeriesFromTaskInput = typeof createSeriesFromTaskSchema.infer;
export type PatchTaskSeriesInput = typeof patchTaskSeriesSchema.infer;
