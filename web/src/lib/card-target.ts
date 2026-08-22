import { cardContext } from './card-context.svelte';
import { cardCursor } from './card-cursor.svelte';
import { router } from './router.svelte';
import { selection } from './selection.svelte';

export function cardTarget(): string | null {
  const route = router.current;
  if (route.name === 'project') {
    return route.params.taskId ?? (route.params.view === 'board' ? selection.cursorTaskId : null);
  }
  if (route.name === 'my-tasks' || route.name === 'search') {
    return cardCursor.taskId;
  }
  return null;
}

// Every menu and mutation this reaches writes to the board, so for a viewer it has
// to answer null rather than offer an action whose every path 403s.
export function editableCardTarget(): string | null {
  const taskId = cardTarget();
  if (taskId === null) {
    return null;
  }
  return cardContext.canWrite(taskId) ? taskId : null;
}
