import type { components } from '../api/api.generated';

type MyTaskLink = components['schemas']['MyTaskLink'];
type MyTaskPersonGroup = components['schemas']['MyTaskPersonGroup'];

// A plain module rather than part of the store: nothing here is reactive, and
// the maps below are discarded before the result is returned. Kept out of
// `.svelte.ts` so that stays what it says it is — state — and so this can be
// tested without one.
//
// Each page of my-tasks groups only its own cards, so a second page has to be
// merged into the first rather than appended: one person can appear on both,
// and the same card can reach a group from two different tasks of the caller's.
export function mergePersonGroups(
  existing: readonly MyTaskPersonGroup[],
  incoming: readonly MyTaskPersonGroup[]
): MyTaskPersonGroup[] {
  const byUser = new Map<string | null, Map<string, MyTaskLink>>();
  for (const group of [...existing, ...incoming]) {
    let tasks = byUser.get(group.user_id);
    if (tasks === undefined) {
      tasks = new Map();
      byUser.set(group.user_id, tasks);
    }
    for (const task of group.tasks) {
      tasks.set(task.id, task);
    }
  }
  // The server's ordering, restated because a merged group's size is not known
  // until every page is in: busiest first, unassigned last.
  return [...byUser]
    .map(([user_id, tasks]) => ({ user_id, tasks: [...tasks.values()] }))
    .sort((a, b) => {
      if (a.user_id === null || b.user_id === null) {
        return a.user_id === b.user_id ? 0 : a.user_id === null ? 1 : -1;
      }
      return b.tasks.length - a.tasks.length || a.user_id.localeCompare(b.user_id);
    });
}
