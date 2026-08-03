import { board } from './board.svelte';
import { router } from './router.svelte';
import { selection } from './selection.svelte';

export function cardTarget(): string | null {
  const route = router.current;
  if (route.name !== 'project') {
    return null;
  }
  return route.params.taskId ?? (route.params.view === 'board' ? selection.selectedTaskId : null);
}

// Every menu and mutation this reaches writes to the board, so for a viewer it has
// to answer null rather than offer an action whose every path 403s.
export function editableCardTarget(): string | null {
  return board.canEdit ? cardTarget() : null;
}
