import type { BoardColumn, BoardPayload, BoardTask } from './resolve';

export function sortedColumns(board: BoardPayload): BoardColumn[] {
  return [...board.columns].sort((a, b) => a.position - b.position);
}

export function sortedTasksIn(board: BoardPayload, columnId: string): BoardTask[] {
  return board.tasks
    .filter((task) => task.column_id === columnId)
    .sort((a, b) => a.position - b.position);
}

export function doneColumnIds(board: BoardPayload): Set<string> {
  return new Set(board.columns.filter((column) => column.is_done).map((column) => column.id));
}

export function taskById(board: BoardPayload): Map<string, BoardTask> {
  return new Map(board.tasks.map((task) => [task.id, task]));
}

export type TaskState = 'done' | 'ready' | 'blocked';

export function taskState(task: BoardTask, board: BoardPayload): TaskState {
  const done = doneColumnIds(board);
  if (done.has(task.column_id)) {
    return 'done';
  }
  const tasks = taskById(board);
  const blockedBy = task.blocker_ids.filter((id) => {
    const blocker = tasks.get(id);
    return blocker != null && !done.has(blocker.column_id);
  });
  return blockedBy.length > 0 ? 'blocked' : 'ready';
}

export interface BlockerNode {
  task: BoardTask;
  state: TaskState;
  blockers: BlockerNode[];
}

export function blockerTree(board: BoardPayload, taskId: string): BlockerNode | null {
  const tasks = taskById(board);

  function build(id: string, seen: Set<string>): BlockerNode | null {
    const task = tasks.get(id);
    if (task == null || seen.has(id)) {
      return null;
    }
    const nextSeen = new Set(seen).add(id);
    return {
      task,
      state: taskState(task, board),
      blockers: task.blocker_ids
        .map((blockerId) => build(blockerId, nextSeen))
        .filter((node): node is BlockerNode => node != null),
    };
  }

  return build(taskId, new Set());
}
