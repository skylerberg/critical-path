import { type } from 'arktype';

export const myTaskLinkSchema = type({
  id: 'string',
  project_id: 'string',
  title: 'string',
  assignee_ids: 'string[]',
});

export type MyTaskLink = typeof myTaskLinkSchema.infer;

export const myTaskSchema = type({
  id: 'string',
  project_id: 'string',
  project_name: 'string',
  column_name: 'string',
  title: 'string',
  assignee_ids: 'string[]',
  bucket: "'blocking' | 'ready' | 'blocked'",
  waiting_user_ids: 'string[]',
  blocking: myTaskLinkSchema.array(),
  blocked_by: myTaskLinkSchema.array(),
});

export type MyTask = typeof myTaskSchema.infer;

export const myTaskPersonGroupSchema = type({
  user_id: 'string | null',
  tasks: myTaskLinkSchema.array(),
});

export type MyTaskPersonGroup = typeof myTaskPersonGroupSchema.infer;

export const myTasksResponseSchema = type({
  tasks: myTaskSchema.array(),
  waiting_on_you: myTaskPersonGroupSchema.array(),
  you_are_waiting_on: myTaskPersonGroupSchema.array(),
});

export type MyTasksResponse = typeof myTasksResponseSchema.infer;
