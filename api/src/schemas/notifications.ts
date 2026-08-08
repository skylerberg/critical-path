import { type } from 'arktype';

export const notificationKind = type(
  "'task_assigned' | 'added_to_project' | 'bulk_task_assigned' | 'mentioned'"
);

export type NotificationKind = typeof notificationKind.infer;

export const notificationSettingsSchema = type({
  task_assigned: 'boolean',
  added_to_project: 'boolean',
  bulk_task_assigned: 'boolean',
  mentioned: 'boolean',
});

export type NotificationSettings = typeof notificationSettingsSchema.infer;

// Every key optional, so a client sends the preference it changed rather than
// the whole set. That is also what lets a kind be added without the browser tab
// holding the previous bundle failing every save until it reloads.
export const notificationSettingsUpdateSchema = type({
  'task_assigned?': 'boolean',
  'added_to_project?': 'boolean',
  'bulk_task_assigned?': 'boolean',
  'mentioned?': 'boolean',
});

export type NotificationSettingsUpdate = typeof notificationSettingsUpdateSchema.infer;

export const unsubscribeResponseSchema = type({
  kind: notificationKind,
});
