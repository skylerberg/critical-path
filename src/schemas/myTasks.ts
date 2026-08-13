import { type } from 'arktype';
import { nonNegativeIntegerParam } from './common';

export const myTasksQuerySchema = type({
  'offset?': nonNegativeIntegerParam,
});

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
  // Open edges whose far end is in a project the caller cannot read. They are
  // counted rather than listed because a link carries a title, a project id and
  // its assignees, none of which the caller is entitled to. A hidden blocker
  // still files the task as blocked; a hidden dependent never names anyone, so
  // it cannot put the task in the blocking bucket.
  hidden_blocked_by_count: 'number',
  hidden_blocking_count: 'number',
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
  // The offset that fetches the next page, or null at the end. The page is big
  // enough that most callers only ever see null, so a client that ignores this
  // is correct for almost everyone — and wrong in exactly the case that matters.
  next_offset: 'number | null',
});

export type MyTasksResponse = typeof myTasksResponseSchema.infer;
