import { type } from 'arktype';

export const crossProjectDependencySchema = type({
  task_id: 'string',
  project_id: 'string',
  project_name: 'string',
  title: 'string',
  is_done: 'boolean',
});

export type CrossProjectDependency = typeof crossProjectDependencySchema.infer;

// An edge the caller may not read is counted, never listed: there is no field
// here that could hold a redacted value, so no later change can accidentally
// populate one. The counts cover open edges only, matching
// open_cross_project_blocker_count — counting the done ones too would let a
// caller subtract the two and learn that a task they cannot see is finished.
export const crossProjectDependenciesResponseSchema = type({
  blocked_by: crossProjectDependencySchema.array(),
  blocking: crossProjectDependencySchema.array(),
  hidden_blocked_by_count: 'number',
  hidden_blocking_count: 'number',
});

export type CrossProjectDependenciesResponse = typeof crossProjectDependenciesResponseSchema.infer;
