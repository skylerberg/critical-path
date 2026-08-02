import { type } from 'arktype';

export const notificationKind = type("'task_assigned' | 'added_to_project'");

export type NotificationKind = typeof notificationKind.infer;

export const notificationSettingsSchema = type({
  task_assigned: 'boolean',
  added_to_project: 'boolean',
});

export type NotificationSettings = typeof notificationSettingsSchema.infer;

export const unsubscribeResponseSchema = type({
  kind: notificationKind,
});
