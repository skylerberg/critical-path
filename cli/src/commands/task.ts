import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { leaf, withCtx, type Opts } from '../kit';
import { CliError, EXIT, assertOk } from '../api/errors';
import { confirmOrAbort, readAllStdin } from '../prompt';
import { displayTitle } from '../output';
import {
  UUID_RE,
  fetchBoard,
  fetchTaskOrNull,
  listArchivedTasks,
  listUsers,
  matchArchivedTask,
  matchRefOrNull,
  projectRefOrNull,
  resolveBoard,
  resolveColumn,
  resolveLabel,
  resolveProject,
  resolveTaskId,
  resolveTaskInBoard,
  resolveUser,
  type ArchivedTask,
  type BoardColumn,
  type BoardPayload,
  type BoardTask,
} from '../resolve';
import {
  blockerTree,
  dependentTree,
  dependents,
  doneColumnIds,
  sortedColumns,
  sortedTasksIn,
  taskById,
  taskState,
  type TaskState,
} from '../board';
import {
  append,
  positionForPlacement,
  positionsForIndex,
  positionsForPlacement,
  type Placement,
} from '../positions';
import { markdownToTiptap, tiptapToMarkdown, type TiptapDoc } from '../markdown';
import { normalizeWebUrl } from '../config';
import { decodeId, taskUrl } from '../short-links';
import type { CliDeps, RuntimeContext } from '../context';

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function taskLeaf(name: string): Command {
  return leaf(name).option('--project <project>', 'project id or name');
}

function placementFrom(opts: Opts): Placement {
  return {
    top: opts.top === true,
    bottom: opts.bottom === true,
    before: opts.before as string | undefined,
    after: opts.after as string | undefined,
  };
}

function addPlacementOptions(command: Command): Command {
  return command
    .option('--top', 'place at the top of the column')
    .option('--bottom', 'place at the bottom of the column')
    .option('--before <task>', 'place before this task (id or title)')
    .option('--after <task>', 'place after this task (id or title)');
}

function columnAnchorResolver(board: BoardPayload, column: BoardColumn): (ref: string) => string {
  return (ref) => {
    const anchor = resolveTaskInBoard(board, ref);
    if (anchor.column_id !== column.id) {
      throw new CliError(
        `Task "${displayTitle(anchor.title)}" is not in column "${column.name}"`,
        EXIT.usage
      );
    }
    return anchor.id;
  };
}

function stateMark(ctx: RuntimeContext, state: TaskState): string {
  if (state === 'blocked') {
    return ctx.out.style(['red'], '[blocked]');
  }
  if (state === 'ready') {
    return ctx.out.style(['green'], '[ready]');
  }
  return '[done]';
}

function dependencyLine(
  ctx: RuntimeContext,
  task: BoardTask,
  state: TaskState,
  depth: number
): string {
  return `${'  '.repeat(depth)}${task.id.slice(0, 8)}  ${stateMark(ctx, state)}  ${displayTitle(task.title)}`;
}

function withState(board: BoardPayload, tasks: BoardTask[]): (BoardTask & { state: TaskState })[] {
  return tasks.map((task) => ({ ...task, state: taskState(task, board) }));
}

function renderDependencySection(
  ctx: RuntimeContext,
  board: BoardPayload,
  label: string,
  tasks: BoardTask[]
): void {
  if (tasks.length === 0) {
    return;
  }
  ctx.out.line(`${label}:`);
  for (const task of tasks) {
    ctx.out.line(dependencyLine(ctx, task, taskState(task, board), 1));
  }
}

function renderTreeSection<T extends { task: BoardTask; state: TaskState }>(
  ctx: RuntimeContext,
  label: string,
  nodes: T[],
  childrenOf: (node: T) => T[]
): void {
  if (nodes.length === 0) {
    return;
  }
  ctx.out.line(`${label}:`);
  const walk = (list: T[], depth: number): void => {
    for (const node of list) {
      ctx.out.line(dependencyLine(ctx, node.task, node.state, depth));
      walk(childrenOf(node), depth + 1);
    }
  };
  walk(nodes, 1);
}

function blockedByTasks(board: BoardPayload, blockerIds: string[]): BoardTask[] {
  const byId = taskById(board);
  return blockerIds.map((id) => byId.get(id)).filter((task): task is BoardTask => task != null);
}

interface TaskContext {
  board: BoardPayload;
  task: BoardTask;
}

// Null rather than a throw: the caller may still have a title tier to try.
async function taskContextById(
  ctx: RuntimeContext,
  id: string,
  opts: { includeArchived?: boolean }
): Promise<TaskContext | null> {
  const detail = await fetchTaskOrNull(ctx, id);
  if (detail === null) {
    return null;
  }
  const board = await fetchBoard(ctx, detail.project_id);
  const named = (t: BoardTask | ArchivedTask): boolean => t.id.toLowerCase() === id.toLowerCase();
  const task = board.tasks.find(named);
  if (task != null) {
    return { board, task };
  }
  // Archived cards are absent from the board every task ref resolves through, so
  // the commands that must still address them opt into a second lookup.
  if (opts.includeArchived === true) {
    const archived = (await listArchivedTasks(ctx, board.project.id)).find(named);
    if (archived != null) {
      return { board, task: archived };
    }
  }
  return null;
}

async function resolveTaskContext(
  ctx: RuntimeContext,
  ref: string,
  projectRef?: string,
  opts: { includeArchived?: boolean } = {}
): Promise<TaskContext> {
  // Both forms name a task outright, so neither needs a project to look in.
  const decoded = decodeId(ref);
  const id = UUID_RE.test(ref) ? ref : decoded;
  if (id !== null) {
    const found = await taskContextById(ctx, id, opts);
    if (found !== null) {
      return found;
    }
    // An alias is also a legal title, so one that names no task falls through to
    // the title tiers instead of shadowing them — but a uuid is only ever an id,
    // and titles need a project to live in.
    if (decoded === null || projectRefOrNull(ctx, projectRef) === null) {
      throw new CliError(`No task matching "${ref}"`, EXIT.notFound);
    }
  }
  const board = await resolveBoard(ctx, projectRef);
  const task = matchRefOrNull(
    ref,
    board.tasks,
    'task',
    (t) => t.id,
    (t) => t.title
  );
  if (task !== null) {
    return { board, task };
  }
  if (opts.includeArchived === true) {
    return { board, task: matchArchivedTask(await listArchivedTasks(ctx, board.project.id), ref) };
  }
  throw new CliError(`No task matching "${ref}"`, EXIT.notFound);
}

async function descriptionFrom(
  ctx: RuntimeContext,
  opts: Opts,
  allowClear: boolean
): Promise<TiptapDoc | null | undefined> {
  const flags = ['--description', '--description-file', '--description-json'];
  const given = [
    typeof opts.description === 'string',
    typeof opts.descriptionFile === 'string',
    typeof opts.descriptionJson === 'string',
  ];
  if (allowClear) {
    flags.push('--clear-description');
    given.push(opts.clearDescription === true);
  }
  if (given.filter(Boolean).length > 1) {
    throw new CliError(`Pass at most one of ${flags.join(', ')}`, EXIT.usage);
  }
  if (allowClear && opts.clearDescription === true) {
    return null;
  }
  if (typeof opts.description === 'string') {
    return markdownToTiptap(opts.description);
  }
  if (typeof opts.descriptionFile === 'string') {
    return markdownToTiptap(await readFile(opts.descriptionFile, 'utf8'));
  }
  if (typeof opts.descriptionJson === 'string') {
    const raw =
      opts.descriptionJson === '-'
        ? await readAllStdin(ctx)
        : await readFile(opts.descriptionJson, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CliError('--description-json is not valid JSON', EXIT.invalid);
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { type?: unknown }).type !== 'doc'
    ) {
      throw new CliError(
        '--description-json must be a Tiptap doc: {"type":"doc","content":[...]}',
        EXIT.invalid
      );
    }
    return parsed as TiptapDoc;
  }
  return undefined;
}

const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dueFrom(opts: Opts, allowClear: boolean): string | null | undefined {
  const clearing = allowClear && opts.clearDue === true;
  if (typeof opts.due === 'string' && clearing) {
    throw new CliError('Pass at most one of --due, --clear-due', EXIT.usage);
  }
  if (clearing) {
    return null;
  }
  if (typeof opts.due !== 'string') {
    return undefined;
  }
  if (!CALENDAR_DATE_RE.test(opts.due)) {
    throw new CliError('--due must be a date like YYYY-MM-DD', EXIT.invalid);
  }
  return opts.due;
}

function defaultColumn(board: BoardPayload): BoardColumn {
  const column = sortedColumns(board).find((c) => !c.is_done);
  if (column == null) {
    throw new CliError(
      'Every column in this project is a done column; pass --column',
      EXIT.failure
    );
  }
  return column;
}

async function resolveUserIds(
  ctx: RuntimeContext,
  refs: string[],
  projectId: string
): Promise<string[]> {
  const ids: string[] = [];
  for (const ref of refs) {
    const user = await resolveUser(ctx, ref, projectId);
    if (!ids.includes(user.id)) {
      ids.push(user.id);
    }
  }
  return ids;
}

// Mirrors the batch endpoint's own limit, so an oversized file fails before a
// request rather than coming back as a raw schema error.
const MAX_BATCH_TASKS = 100;

function targetColumn(board: BoardPayload, opts: Opts): BoardColumn {
  return typeof opts.column === 'string' ? resolveColumn(board, opts.column) : defaultColumn(board);
}

async function createOneTask(ctx: RuntimeContext, opts: Opts, title: string): Promise<void> {
  const description = await descriptionFrom(ctx, opts, false);
  const due = dueFrom(opts, false);
  const board = await resolveBoard(ctx, opts.project as string | undefined);
  const column = targetColumn(board, opts);
  const position = positionForPlacement(
    placementFrom(opts),
    sortedTasksIn(board, column.id),
    columnAnchorResolver(board, column)
  );
  const labelIds = dedupe((opts.label as string[]).map((ref) => resolveLabel(board, ref).id));
  const assigneeIds = await resolveUserIds(ctx, opts.assignee as string[], board.project.id);
  const created = assertOk(
    await ctx.api.POST('/api/tasks', {
      body: {
        id: crypto.randomUUID(),
        project_id: board.project.id,
        column_id: column.id,
        title,
        position,
        ...(description !== undefined ? { description } : {}),
        ...(due !== undefined ? { due_date: due } : {}),
        ...(labelIds.length > 0 ? { label_ids: labelIds } : {}),
        ...(assigneeIds.length > 0 ? { assignee_ids: assigneeIds } : {}),
      },
    })
  );
  ctx.out.data(created, () =>
    ctx.out.line(
      `Created task "${displayTitle(created.title)}" (${created.id.slice(0, 8)}) in ${column.name}`
    )
  );
}

async function createManyTasks(ctx: RuntimeContext, opts: Opts): Promise<void> {
  // --label and --assignee collect into an array that defaults to [], which is
  // truthy, so presence is length and not definedness.
  if (
    (opts.label as string[]).length > 0 ||
    (opts.assignee as string[]).length > 0 ||
    typeof opts.description === 'string' ||
    typeof opts.descriptionFile === 'string' ||
    typeof opts.descriptionJson === 'string' ||
    typeof opts.due === 'string'
  ) {
    throw new CliError(
      '- cannot be combined with --description, --description-file, --description-json, --due, --label, or --assignee',
      EXIT.usage
    );
  }

  // Draining a terminal would look like a hang until the user guessed Ctrl-D.
  if (ctx.deps.stdin.isTTY === true) {
    throw new CliError(
      'Pipe one title per line into `task create -` (e.g. `task create - < titles.txt`)',
      EXIT.usage
    );
  }

  const titles = (await readAllStdin(ctx))
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (titles.length === 0) {
    throw new CliError('No task titles on stdin', EXIT.usage);
  }
  if (titles.length > MAX_BATCH_TASKS) {
    throw new CliError(
      `Too many titles on stdin (${String(titles.length)}); create at most ${String(MAX_BATCH_TASKS)} at a time`,
      EXIT.invalid
    );
  }

  const board = await resolveBoard(ctx, opts.project as string | undefined);
  const column = targetColumn(board, opts);
  const positions = positionsForPlacement(
    placementFrom(opts),
    sortedTasksIn(board, column.id),
    columnAnchorResolver(board, column),
    titles.length
  );
  const created = assertOk(
    await ctx.api.POST('/api/tasks/batch', {
      body: {
        project_id: board.project.id,
        column_id: column.id,
        tasks: titles.map((title, index) => ({
          id: crypto.randomUUID(),
          title,
          position: positions[index],
        })),
      },
    })
  );
  ctx.out.data(created.tasks, () => {
    const count = created.tasks.length;
    ctx.out.line(`Created ${String(count)} task${count === 1 ? '' : 's'} in ${column.name}`);
    ctx.out.table(
      ['ID', 'TITLE'],
      created.tasks.map((t) => [t.id.slice(0, 8), displayTitle(t.title)])
    );
  });
}

async function updateLabels(
  ctx: RuntimeContext,
  opts: Opts,
  taskRef: string,
  labelRefs: string[],
  next: (current: string[], ids: string[]) => string[]
): Promise<void> {
  const { board, task } = await resolveTaskContext(
    ctx,
    taskRef,
    opts.project as string | undefined
  );
  const ids = dedupe(labelRefs.map((ref) => resolveLabel(board, ref).id));
  const labelIds = next(task.label_ids, ids);
  assertOk(
    await ctx.api.PUT('/api/tasks/{id}/labels', {
      params: { path: { id: task.id } },
      body: { label_ids: labelIds },
    })
  );
  const nameById = new Map(board.labels.map((l) => [l.id, l.name]));
  const names = labelIds.map((id) => nameById.get(id) ?? id);
  ctx.out.data({ task_id: task.id, label_ids: labelIds }, () =>
    ctx.out.line(
      names.length > 0
        ? `Labels on "${displayTitle(task.title)}": ${names.join(', ')}`
        : `Cleared labels on "${displayTitle(task.title)}"`
    )
  );
}

async function updateAssignees(
  ctx: RuntimeContext,
  opts: Opts,
  taskRef: string,
  userRefs: string[],
  next: (current: string[], ids: string[]) => string[]
): Promise<void> {
  const { board, task } = await resolveTaskContext(
    ctx,
    taskRef,
    opts.project as string | undefined
  );
  const ids = await resolveUserIds(ctx, userRefs, board.project.id);
  const userIds = next(task.assignee_ids, ids);
  assertOk(
    await ctx.api.PUT('/api/tasks/{id}/assignees', {
      params: { path: { id: task.id } },
      body: { user_ids: userIds },
    })
  );
  const users = await listUsers(ctx, board.project.id);
  const userById = new Map(users.map((u) => [u.id, u]));
  const names = userIds.map((id) => {
    const user = userById.get(id);
    return user == null ? id : `${user.name} <${user.email}>`;
  });
  ctx.out.data({ task_id: task.id, assignee_ids: userIds }, () =>
    ctx.out.line(
      names.length > 0
        ? `Assignees on "${displayTitle(task.title)}": ${names.join(', ')}`
        : `Cleared assignees on "${displayTitle(task.title)}"`
    )
  );
}

export function registerTask(program: Command, deps: CliDeps): void {
  const task = new Command('task').description('Manage tasks');

  task.addCommand(
    taskLeaf('list')
      .description('List tasks with optional filters')
      .option('--column <column>', 'filter by column (id or name)')
      .option('--label <label>', 'filter by label (id or name)')
      .option('--assignee <user>', 'filter by assignee (user id, name, or email)')
      .option('--ready', 'only unfinished tasks with no unfinished blockers')
      .option('--blocked', 'only tasks with unfinished blockers')
      .option('--done', 'only tasks in done columns')
      .option('--not-done', 'only tasks not in done columns')
      .option('--search <text>', 'case-insensitive title substring')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const board = await resolveBoard(ctx, opts.project as string | undefined);
          const filters: ((t: BoardTask) => boolean)[] = [];
          if (typeof opts.column === 'string') {
            const column = resolveColumn(board, opts.column);
            filters.push((t) => t.column_id === column.id);
          }
          if (typeof opts.label === 'string') {
            const label = resolveLabel(board, opts.label);
            filters.push((t) => t.label_ids.includes(label.id));
          }
          if (typeof opts.assignee === 'string') {
            const user = await resolveUser(ctx, opts.assignee, board.project.id);
            filters.push((t) => t.assignee_ids.includes(user.id));
          }
          const done = doneColumnIds(board);
          if (opts.done === true) {
            filters.push((t) => done.has(t.column_id));
          }
          if (opts.notDone === true) {
            filters.push((t) => !done.has(t.column_id));
          }
          if (opts.ready === true) {
            filters.push((t) => taskState(t, board) === 'ready');
          }
          if (opts.blocked === true) {
            filters.push((t) => taskState(t, board) === 'blocked');
          }
          if (typeof opts.search === 'string') {
            const needle = opts.search.toLowerCase();
            filters.push((t) => t.title.toLowerCase().includes(needle));
          }
          const columnOrder = new Map(sortedColumns(board).map((c, i) => [c.id, i]));
          const columnName = new Map(board.columns.map((c) => [c.id, c.name]));
          const tasks = board.tasks
            .filter((t) => filters.every((matches) => matches(t)))
            .sort(
              (a, b) =>
                (columnOrder.get(a.column_id) ?? 0) - (columnOrder.get(b.column_id) ?? 0) ||
                a.position - b.position
            )
            .map((t) => ({ ...t, state: taskState(t, board) }));
          ctx.out.data(tasks, () => {
            if (tasks.length === 0) {
              ctx.out.line('No matching tasks');
              return;
            }
            ctx.out.table(
              ['ID', 'STATE', 'COLUMN', 'TITLE'],
              tasks.map((t) => [
                t.id.slice(0, 8),
                t.state,
                columnName.get(t.column_id) ?? '',
                displayTitle(t.title),
              ])
            );
          });
        })
      )
  );

  task.addCommand(
    taskLeaf('show')
      .description('Show a task in detail')
      .argument('<task>', 'task id or title')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const taskId = await resolveTaskId(ctx, ref, opts.project as string | undefined, {
            includeArchived: true,
          });
          const detail = assertOk(
            await ctx.api.GET('/api/tasks/{id}', { params: { path: { id: taskId } } })
          );
          const board = await fetchBoard(ctx, detail.project_id);
          const state = taskState(detail, board);
          const users =
            detail.assignee_ids.length > 0 ? await listUsers(ctx, detail.project_id) : [];
          const userById = new Map(users.map((u) => [u.id, u]));
          const blockedBy = blockedByTasks(board, detail.blocker_ids);
          const blocks = dependents(board, detail.id);
          ctx.out.data({ ...detail, state, blocked_task_ids: blocks.map((t) => t.id) }, () => {
            const columnName =
              board.columns.find((c) => c.id === detail.column_id)?.name ?? detail.column_id;
            const labelName = new Map(board.labels.map((l) => [l.id, l.name]));
            ctx.out.line(ctx.out.style(['bold'], detail.title));
            ctx.out.line(`ID:        ${detail.id.slice(0, 8)} (${detail.id})`);
            ctx.out.line(`State:     ${state}`);
            ctx.out.line(`Column:    ${columnName}`);
            ctx.out.line(`Created:   ${detail.created_at}`);
            ctx.out.line(`Updated:   ${detail.updated_at}`);
            if (detail.due_date != null) {
              ctx.out.line(`Due:       ${detail.due_date}`);
            }
            if (detail.archived_at != null) {
              ctx.out.line(`Archived:  ${detail.archived_at}`);
            }
            if (detail.label_ids.length > 0) {
              const names = detail.label_ids.map((id) => labelName.get(id) ?? id);
              ctx.out.line(`Labels:    ${names.join(', ')}`);
            }
            if (detail.assignee_ids.length > 0) {
              const names = detail.assignee_ids.map((id) => {
                const user = userById.get(id);
                return user == null ? id : `${user.name} <${user.email}>`;
              });
              ctx.out.line(`Assignees: ${names.join(', ')}`);
            }
            renderDependencySection(ctx, board, 'Blocked by', blockedBy);
            renderDependencySection(ctx, board, 'Blocks', blocks);
            if (detail.images.length > 0) {
              ctx.out.line('Images:');
              for (const image of detail.images) {
                ctx.out.line(`  ${image.id}  ${image.filename}`);
              }
            }
            if (detail.description != null) {
              ctx.out.line();
              ctx.out.line(tiptapToMarkdown(detail.description));
            }
          });
        })
      )
  );

  task.addCommand(
    addPlacementOptions(
      taskLeaf('create')
        .description('Create a task (in the first non-done column by default)')
        .argument('<title>', 'task title, or - to read one title per line from stdin (max 100)')
        .option('--column <column>', 'target column (id or name)')
        .option('--description <markdown>', 'description as Markdown (no mentions)')
        .option(
          '--description-file <path>',
          'read the Markdown description from a file (no mentions)'
        )
        .option(
          '--description-json <path>',
          'read a Tiptap JSON description from a file (- for stdin)'
        )
        .option('--due <date>', 'due date as YYYY-MM-DD')
        .option('--label <label>', 'label id or name (repeatable)', collect, [] as string[])
        .option(
          '--assignee <user>',
          'assignee user id, name, or email (repeatable)',
          collect,
          [] as string[]
        )
    ).action(
      withCtx(deps, async (ctx, opts, title) =>
        title === '-' ? createManyTasks(ctx, opts) : createOneTask(ctx, opts, title)
      )
    )
  );

  task.addCommand(
    taskLeaf('update')
      .description('Update the title, description or due date of a task')
      .argument('<task>', 'task id or title')
      .option('--title <title>', 'new title')
      .option('--description <markdown>', 'new description as Markdown (drops any @mentions)')
      .option(
        '--description-file <path>',
        'read the Markdown description from a file (drops any @mentions)'
      )
      .option(
        '--description-json <path>',
        'read a Tiptap JSON description from a file (- for stdin)'
      )
      .option('--clear-description', 'remove the description')
      .option('--due <date>', 'due date as YYYY-MM-DD')
      .option('--clear-due', 'remove the due date')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const description = await descriptionFrom(ctx, opts, true);
          const due = dueFrom(opts, true);
          const title = opts.title as string | undefined;
          if (title === undefined && description === undefined && due === undefined) {
            throw new CliError(
              'Pass --title, --description, --description-file, --description-json, --clear-description, --due, or --clear-due',
              EXIT.usage
            );
          }
          const { task: target } = await resolveTaskContext(
            ctx,
            ref,
            opts.project as string | undefined
          );
          const body: { title?: string; description?: TiptapDoc | null; due_date?: string | null } =
            {};
          if (title !== undefined) {
            body.title = title;
          }
          if (description !== undefined) {
            body.description = description;
          }
          if (due !== undefined) {
            body.due_date = due;
          }
          const updated = assertOk(
            await ctx.api.PATCH('/api/tasks/{id}', { params: { path: { id: target.id } }, body })
          );
          ctx.out.data(updated, () =>
            ctx.out.line(`Updated task "${displayTitle(updated.title)}"`)
          );
        })
      )
  );

  task.addCommand(
    addPlacementOptions(
      taskLeaf('move')
        .description('Move a task within or between columns')
        .argument('<task>', 'task id or title')
        .option('--column <column>', 'target column (default: the current column)')
    ).action(
      withCtx(deps, async (ctx, opts, ref) => {
        const { board, task: target } = await resolveTaskContext(
          ctx,
          ref,
          opts.project as string | undefined
        );
        const column =
          typeof opts.column === 'string'
            ? resolveColumn(board, opts.column)
            : resolveColumn(board, target.column_id);
        const others = sortedTasksIn(board, column.id).filter((t) => t.id !== target.id);
        const position = positionForPlacement(
          placementFrom(opts),
          others,
          columnAnchorResolver(board, column)
        );
        const moved = assertOk(
          await ctx.api.PATCH('/api/tasks/{id}', {
            params: { path: { id: target.id } },
            body: { column_id: column.id, position },
          })
        );
        ctx.out.data(moved, () =>
          ctx.out.line(`Moved "${displayTitle(moved.title)}" to ${column.name}`)
        );
      })
    )
  );

  task.addCommand(
    taskLeaf('done')
      .description('Move a task to the bottom of the last done column')
      .argument('<task>', 'task id or title')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const { board, task: target } = await resolveTaskContext(
            ctx,
            ref,
            opts.project as string | undefined
          );
          const doneColumns = sortedColumns(board).filter((c) => c.is_done);
          if (doneColumns.length === 0) {
            throw new CliError('This project has no done column', EXIT.failure);
          }
          const column = doneColumns[doneColumns.length - 1];
          const others = sortedTasksIn(board, column.id).filter((t) => t.id !== target.id);
          const position = append(others.map((t) => t.position));
          const moved = assertOk(
            await ctx.api.PATCH('/api/tasks/{id}', {
              params: { path: { id: target.id } },
              body: { column_id: column.id, position },
            })
          );
          ctx.out.data(moved, () =>
            ctx.out.line(`Marked "${displayTitle(moved.title)}" done (${column.name})`)
          );
        })
      )
  );

  task.addCommand(
    taskLeaf('duplicate')
      .description('Copy a task directly below the original')
      .argument('<task>', 'task id or title')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const { board, task: target } = await resolveTaskContext(
            ctx,
            ref,
            opts.project as string | undefined,
            { includeArchived: true }
          );
          const siblings = sortedTasksIn(board, target.column_id);
          const index = siblings.findIndex((t) => t.id === target.id);
          // An archived source is off the board, so there is no card to sit below.
          const insertAt = index === -1 ? siblings.length : index + 1;
          const position = positionsForIndex(
            siblings.map((t) => t.position),
            insertAt,
            1,
            'move a card in this column to make room'
          )[0];
          const created = assertOk(
            await ctx.api.POST('/api/tasks/{id}/duplicate', {
              params: { path: { id: target.id } },
              body: { id: crypto.randomUUID(), position },
            })
          );
          ctx.out.data(created, () =>
            ctx.out.line(
              `Duplicated task "${displayTitle(created.title)}" (${created.id.slice(0, 8)})`
            )
          );
        })
      )
  );

  task.addCommand(
    taskLeaf('archive')
      .description('Archive a task: it leaves the board but stays restorable')
      .argument('<task>', 'task id or title')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const { task: target } = await resolveTaskContext(
            ctx,
            ref,
            opts.project as string | undefined,
            { includeArchived: true }
          );
          const archived = assertOk(
            await ctx.api.POST('/api/tasks/{id}/archive', { params: { path: { id: target.id } } })
          );
          ctx.out.data(archived, () =>
            ctx.out.line(`Archived task "${displayTitle(archived.title)}"`)
          );
        })
      )
  );

  task.addCommand(
    taskLeaf('restore')
      .description('Restore an archived task to its column')
      .argument('<archived-task>', 'archived task id or title')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const taskId = await resolveTaskId(ctx, ref, opts.project as string | undefined, {
            includeArchived: true,
          });
          const restored = assertOk(
            await ctx.api.POST('/api/tasks/{id}/restore', { params: { path: { id: taskId } } })
          );
          ctx.out.data(restored, () =>
            ctx.out.line(`Restored task "${displayTitle(restored.title)}"`)
          );
        })
      )
  );

  task.addCommand(
    taskLeaf('archived')
      .description('List archived tasks')
      .option('--search <text>', 'case-insensitive title substring')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const project = await resolveProject(ctx, opts.project as string | undefined);
          const board = await fetchBoard(ctx, project.id);
          const needle = typeof opts.search === 'string' ? opts.search.toLowerCase() : null;
          const tasks = (await listArchivedTasks(ctx, project.id)).filter(
            (t) => needle === null || t.title.toLowerCase().includes(needle)
          );
          const columnName = new Map(board.columns.map((c) => [c.id, c.name]));
          ctx.out.data(tasks, () => {
            if (tasks.length === 0) {
              ctx.out.line('No archived tasks');
              return;
            }
            ctx.out.table(
              ['ID', 'ARCHIVED', 'COLUMN', 'TITLE'],
              tasks.map((t) => [
                t.id.slice(0, 8),
                t.archived_at,
                columnName.get(t.column_id) ?? '',
                displayTitle(t.title),
              ])
            );
          });
        })
      )
  );

  task.addCommand(
    taskLeaf('delete')
      .description('Delete a task')
      .argument('<task>', 'task id or title')
      .option('--force', 'skip the confirmation prompt')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const { task: target } = await resolveTaskContext(
            ctx,
            ref,
            opts.project as string | undefined,
            { includeArchived: true }
          );
          await confirmOrAbort(
            ctx,
            `Delete task "${displayTitle(target.title)}"?`,
            opts.force === true
          );
          assertOk(
            await ctx.api.DELETE('/api/tasks/{id}', { params: { path: { id: target.id } } })
          );
          ctx.out.data({ deleted: true, id: target.id }, () =>
            ctx.out.line(`Deleted task "${displayTitle(target.title)}"`)
          );
        })
      )
  );

  const label = new Command('label').description('Manage the labels on a task');

  label.addCommand(
    taskLeaf('add')
      .description('Add labels to a task')
      .argument('<task>', 'task id or title')
      .argument('<labels...>', 'label ids or names')
      .action(
        withCtx(deps, async (ctx, opts, taskRef, ...rest) => {
          await updateLabels(ctx, opts, taskRef, rest.flat(), (current, ids) =>
            dedupe([...current, ...ids])
          );
        })
      )
  );

  label.addCommand(
    taskLeaf('remove')
      .description('Remove labels from a task')
      .argument('<task>', 'task id or title')
      .argument('<labels...>', 'label ids or names')
      .action(
        withCtx(deps, async (ctx, opts, taskRef, ...rest) => {
          await updateLabels(ctx, opts, taskRef, rest.flat(), (current, ids) =>
            current.filter((id) => !ids.includes(id))
          );
        })
      )
  );

  label.addCommand(
    taskLeaf('set')
      .description('Replace the labels on a task (no labels clears them)')
      .argument('<task>', 'task id or title')
      .argument('[labels...]', 'label ids or names')
      .action(
        withCtx(deps, async (ctx, opts, taskRef, ...rest) => {
          await updateLabels(ctx, opts, taskRef, rest.flat(), (_current, ids) => ids);
        })
      )
  );

  task.addCommand(label);

  task.addCommand(
    taskLeaf('assign')
      .description('Add assignees to a task')
      .argument('<task>', 'task id or title')
      .argument('<users...>', 'user ids, names, or emails')
      .action(
        withCtx(deps, async (ctx, opts, taskRef, ...rest) => {
          await updateAssignees(ctx, opts, taskRef, rest.flat(), (current, ids) =>
            dedupe([...current, ...ids])
          );
        })
      )
  );

  task.addCommand(
    taskLeaf('unassign')
      .description('Remove assignees from a task')
      .argument('<task>', 'task id or title')
      .argument('<users...>', 'user ids, names, or emails')
      .action(
        withCtx(deps, async (ctx, opts, taskRef, ...rest) => {
          await updateAssignees(ctx, opts, taskRef, rest.flat(), (current, ids) =>
            current.filter((id) => !ids.includes(id))
          );
        })
      )
  );

  const assignees = new Command('assignees').description('Replace the assignees on a task');

  assignees.addCommand(
    taskLeaf('set')
      .description('Replace the assignees on a task (no users clears them)')
      .argument('<task>', 'task id or title')
      .argument('[users...]', 'user ids, names, or emails')
      .action(
        withCtx(deps, async (ctx, opts, taskRef, ...rest) => {
          await updateAssignees(ctx, opts, taskRef, rest.flat(), (_current, ids) => ids);
        })
      )
  );

  task.addCommand(assignees);

  task.addCommand(
    taskLeaf('block')
      .description('Record that another task blocks this one')
      .argument('<task>', 'task id or title')
      .requiredOption('--by <task>', 'the blocking task (id or title)')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const { board, task: target } = await resolveTaskContext(
            ctx,
            ref,
            opts.project as string | undefined
          );
          const blocker = resolveTaskInBoard(board, opts.by as string);
          assertOk(
            await ctx.api.POST('/api/tasks/{id}/blockers', {
              params: { path: { id: target.id } },
              body: { blocker_task_id: blocker.id },
            })
          );
          ctx.out.data({ task_id: target.id, blocker_task_id: blocker.id }, () =>
            ctx.out.line(
              `"${displayTitle(blocker.title)}" now blocks "${displayTitle(target.title)}"`
            )
          );
        })
      )
  );

  task.addCommand(
    taskLeaf('unblock')
      .description('Remove a blocker from a task')
      .argument('<task>', 'task id or title')
      .requiredOption('--by <task>', 'the blocking task (id or title)')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const { board, task: target } = await resolveTaskContext(
            ctx,
            ref,
            opts.project as string | undefined
          );
          const blocker = resolveTaskInBoard(board, opts.by as string);
          assertOk(
            await ctx.api.DELETE('/api/tasks/{id}/blockers/{blockerTaskId}', {
              params: { path: { id: target.id, blockerTaskId: blocker.id } },
            })
          );
          ctx.out.data({ task_id: target.id, blocker_task_id: blocker.id }, () =>
            ctx.out.line(
              `"${displayTitle(blocker.title)}" no longer blocks "${displayTitle(target.title)}"`
            )
          );
        })
      )
  );

  task.addCommand(
    taskLeaf('blockers')
      .description('Show what blocks a task and what it blocks')
      .argument('<task>', 'task id or title')
      .option('--tree', 'show the transitive blocker and dependent trees')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const { board, task: target } = await resolveTaskContext(
            ctx,
            ref,
            opts.project as string | undefined
          );
          if (opts.tree === true) {
            const blockedByTree = blockerTree(board, target.id);
            const blocksTree = dependentTree(board, target.id);
            ctx.out.data({ blocked_by_tree: blockedByTree, blocks_tree: blocksTree }, () => {
              if (blockedByTree == null) {
                return;
              }
              ctx.out.line(dependencyLine(ctx, blockedByTree.task, blockedByTree.state, 0));
              renderTreeSection(ctx, 'Blocked by', blockedByTree.blockers, (node) => node.blockers);
              renderTreeSection(
                ctx,
                'Blocks',
                blocksTree?.dependents ?? [],
                (node) => node.dependents
              );
            });
            return;
          }
          const blockedBy = blockedByTasks(board, target.blocker_ids);
          const blocks = dependents(board, target.id);
          ctx.out.data(
            { blocked_by: withState(board, blockedBy), blocks: withState(board, blocks) },
            () => {
              if (blockedBy.length === 0 && blocks.length === 0) {
                ctx.out.line('Nothing blocks this task');
                return;
              }
              renderDependencySection(ctx, board, 'Blocked by', blockedBy);
              renderDependencySection(ctx, board, 'Blocks', blocks);
            }
          );
        })
      )
  );

  task.addCommand(
    taskLeaf('url')
      .description('Print the shareable web URL of a task')
      .argument('<task>', 'task id or title')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const { task: target } = await resolveTaskContext(
            ctx,
            ref,
            opts.project as string | undefined,
            { includeArchived: true }
          );
          const url = taskUrl(normalizeWebUrl(ctx.webUrl), target.id, target.title);
          ctx.out.data({ url }, () => ctx.out.line(url));
        })
      )
  );

  program.addCommand(task);
}
