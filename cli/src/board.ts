import { byRank } from './positions';
import type { BoardColumn, BoardPayload, BoardTask } from './resolve';

export function sortedColumns(board: BoardPayload): BoardColumn[] {
  return [...board.columns].sort(byRank);
}

export function sortedTasksIn(board: BoardPayload, columnId: string): BoardTask[] {
  return board.tasks.filter((task) => task.column_id === columnId).sort(byRank);
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

export function dependents(board: BoardPayload, taskId: string): BoardTask[] {
  return board.tasks.filter((task) => task.blocker_ids.includes(taskId));
}

export interface DependentNode {
  task: BoardTask;
  state: TaskState;
  dependents: DependentNode[];
}

export function dependentTree(board: BoardPayload, taskId: string): DependentNode | null {
  const byBlocker = new Map<string, BoardTask[]>();
  for (const task of board.tasks) {
    for (const blockerId of task.blocker_ids) {
      const existing = byBlocker.get(blockerId);
      if (existing == null) {
        byBlocker.set(blockerId, [task]);
      } else {
        existing.push(task);
      }
    }
  }

  function build(task: BoardTask, seen: Set<string>): DependentNode {
    const nextSeen = new Set(seen).add(task.id);
    return {
      task,
      state: taskState(task, board),
      dependents: (byBlocker.get(task.id) ?? [])
        .filter((child) => !nextSeen.has(child.id))
        .map((child) => build(child, nextSeen)),
    };
  }

  const root = taskById(board).get(taskId);
  return root == null ? null : build(root, new Set());
}
