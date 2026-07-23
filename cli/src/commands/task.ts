import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { leaf, withCtx, type Opts } from '../kit';
import { CliError, EXIT, assertOk } from '../api/errors';
import { confirmOrAbort } from '../prompt';
import {
  UUID_RE,
  fetchBoard,
  listUsers,
  resolveBoard,
  resolveColumn,
  resolveLabel,
  resolveTaskId,
  resolveTaskInBoard,
  resolveUser,
  type BoardColumn,
  type BoardPayload,
  type BoardTask,
} from '../resolve';
import {
  blockerTree,
  doneColumnIds,
  sortedColumns,
  sortedTasksIn,
  taskState,
  type BlockerNode,
  type TaskState,
} from '../board';
import { append, positionForPlacement, type Placement } from '../positions';
import { markdownToTiptap, tiptapToMarkdown, type TiptapDoc } from '../markdown';
import type { CliDeps, RuntimeContext } from '../context';

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function taskLeaf(name: string): Command {
  return leaf(name).option('--project <ref>', 'project id or name');
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
      throw new CliError(`Task "${anchor.title}" is not in column "${column.name}"`, EXIT.usage);
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

interface TaskContext {
  board: BoardPayload;
  task: BoardTask;
}

async function resolveTaskContext(
  ctx: RuntimeContext,
  ref: string,
  projectRef?: string
): Promise<TaskContext> {
  if (UUID_RE.test(ref)) {
    const detail = assertOk(
      await ctx.api.GET('/api/tasks/{id}', { params: { path: { id: ref } } })
    );
    const board = await fetchBoard(ctx, detail.project_id);
    const task = board.tasks.find((t) => t.id.toLowerCase() === ref.toLowerCase());
    if (task == null) {
      throw new CliError(`No task matching "${ref}"`, EXIT.notFound);
    }
    return { board, task };
  }
  const board = await resolveBoard(ctx, projectRef);
  return { board, task: resolveTaskInBoard(board, ref) };
}

async function readAllStdin(ctx: RuntimeContext): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of ctx.deps.stdin) {
    chunks.push(Buffer.from(chunk as string | Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
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
        ? `Labels on "${task.title}": ${names.join(', ')}`
        : `Cleared labels on "${task.title}"`
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
        ? `Assignees on "${task.title}": ${names.join(', ')}`
        : `Cleared assignees on "${task.title}"`
    )
  );
}

export function registerTask(program: Command, deps: CliDeps): void {
  const task = new Command('task').description('Manage tasks');

  task.addCommand(
    taskLeaf('list')
      .description('List tasks with optional filters')
      .option('--column <ref>', 'filter by column (id or name)')
      .option('--label <ref>', 'filter by label (id or name)')
      .option('--assignee <ref>', 'filter by assignee (user id, name, or email)')
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
                t.title,
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
          const taskId = await resolveTaskId(ctx, ref, opts.project as string | undefined);
          const detail = assertOk(
            await ctx.api.GET('/api/tasks/{id}', { params: { path: { id: taskId } } })
          );
          const board = await fetchBoard(ctx, detail.project_id);
          const state = taskState(detail, board);
          const users =
            detail.assignee_ids.length > 0 ? await listUsers(ctx, detail.project_id) : [];
          const userById = new Map(users.map((u) => [u.id, u]));
          ctx.out.data({ ...detail, state }, () => {
            const columnName =
              board.columns.find((c) => c.id === detail.column_id)?.name ?? detail.column_id;
            const labelName = new Map(board.labels.map((l) => [l.id, l.name]));
            const byId = new Map(board.tasks.map((t) => [t.id, t]));
            ctx.out.line(ctx.out.style(['bold'], detail.title));
            ctx.out.line(`ID:        ${detail.id.slice(0, 8)} (${detail.id})`);
            ctx.out.line(`State:     ${state}`);
            ctx.out.line(`Column:    ${columnName}`);
            ctx.out.line(`Created:   ${detail.created_at}`);
            ctx.out.line(`Updated:   ${detail.updated_at}`);
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
            if (detail.blocker_ids.length > 0) {
              ctx.out.line('Blockers:');
              for (const id of detail.blocker_ids) {
                const blocker = byId.get(id);
                if (blocker != null) {
                  const mark = stateMark(ctx, taskState(blocker, board));
                  ctx.out.line(`  ${blocker.id.slice(0, 8)}  ${mark}  ${blocker.title}`);
                }
              }
            }
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
        .argument('<title>', 'task title')
        .option('--column <ref>', 'target column (id or name)')
        .option('--description <markdown>', 'description as Markdown')
        .option('--description-file <path>', 'read the Markdown description from a file')
        .option(
          '--description-json <path>',
          'read a Tiptap JSON description from a file (- for stdin)'
        )
        .option('--label <ref>', 'label id or name (repeatable)', collect, [] as string[])
        .option(
          '--assignee <ref>',
          'assignee user id, name, or email (repeatable)',
          collect,
          [] as string[]
        )
    ).action(
      withCtx(deps, async (ctx, opts, title) => {
        const description = await descriptionFrom(ctx, opts, false);
        const board = await resolveBoard(ctx, opts.project as string | undefined);
        const column =
          typeof opts.column === 'string'
            ? resolveColumn(board, opts.column)
            : defaultColumn(board);
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
              ...(labelIds.length > 0 ? { label_ids: labelIds } : {}),
              ...(assigneeIds.length > 0 ? { assignee_ids: assigneeIds } : {}),
            },
          })
        );
        ctx.out.data(created, () =>
          ctx.out.line(
            `Created task "${created.title}" (${created.id.slice(0, 8)}) in ${column.name}`
          )
        );
      })
    )
  );

  task.addCommand(
    taskLeaf('update')
      .description('Update the title or description of a task')
      .argument('<task>', 'task id or title')
      .option('--title <title>', 'new title')
      .option('--description <markdown>', 'new description as Markdown')
      .option('--description-file <path>', 'read the Markdown description from a file')
      .option(
        '--description-json <path>',
        'read a Tiptap JSON description from a file (- for stdin)'
      )
      .option('--clear-description', 'remove the description')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const description = await descriptionFrom(ctx, opts, true);
          const title = opts.title as string | undefined;
          if (title === undefined && description === undefined) {
            throw new CliError(
              'Pass --title, --description, --description-file, --description-json, or --clear-description',
              EXIT.usage
            );
          }
          const taskId = await resolveTaskId(ctx, ref, opts.project as string | undefined);
          const body: { title?: string; description?: TiptapDoc | null } = {};
          if (title !== undefined) {
            body.title = title;
          }
          if (description !== undefined) {
            body.description = description;
          }
          const updated = assertOk(
            await ctx.api.PATCH('/api/tasks/{id}', { params: { path: { id: taskId } }, body })
          );
          ctx.out.data(updated, () => ctx.out.line(`Updated task "${updated.title}"`));
        })
      )
  );

  task.addCommand(
    addPlacementOptions(
      taskLeaf('move')
        .description('Move a task within or between columns')
        .argument('<task>', 'task id or title')
        .option('--column <ref>', 'target column (default: the current column)')
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
        ctx.out.data(moved, () => ctx.out.line(`Moved "${moved.title}" to ${column.name}`));
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
          ctx.out.data(moved, () => ctx.out.line(`Marked "${moved.title}" done (${column.name})`));
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
            opts.project as string | undefined
          );
          await confirmOrAbort(ctx, `Delete task "${target.title}"?`, opts.force === true);
          assertOk(
            await ctx.api.DELETE('/api/tasks/{id}', { params: { path: { id: target.id } } })
          );
          ctx.out.data({ deleted: true, id: target.id }, () =>
            ctx.out.line(`Deleted task "${target.title}"`)
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
            ctx.out.line(`"${blocker.title}" now blocks "${target.title}"`)
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
            ctx.out.line(`"${blocker.title}" no longer blocks "${target.title}"`)
          );
        })
      )
  );

  task.addCommand(
    taskLeaf('blockers')
      .description('Show what blocks a task')
      .argument('<task>', 'task id or title')
      .option('--tree', 'show the transitive blocker tree')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const { board, task: target } = await resolveTaskContext(
            ctx,
            ref,
            opts.project as string | undefined
          );
          if (opts.tree === true) {
            const tree = blockerTree(board, target.id);
            ctx.out.data(tree, () => {
              if (tree == null) {
                return;
              }
              const render = (node: BlockerNode, depth: number): void => {
                const mark = stateMark(ctx, node.state);
                ctx.out.line(
                  `${'  '.repeat(depth)}${node.task.id.slice(0, 8)}  ${mark}  ${node.task.title}`
                );
                for (const child of node.blockers) {
                  render(child, depth + 1);
                }
              };
              render(tree, 0);
            });
            return;
          }
          const byId = new Map(board.tasks.map((t) => [t.id, t]));
          const blockers = target.blocker_ids
            .map((id) => byId.get(id))
            .filter((t): t is BoardTask => t != null)
            .map((t) => ({ ...t, state: taskState(t, board) }));
          ctx.out.data(blockers, () => {
            if (blockers.length === 0) {
              ctx.out.line('No blockers');
              return;
            }
            ctx.out.table(
              ['ID', 'STATE', 'TITLE'],
              blockers.map((t) => [t.id.slice(0, 8), t.state, t.title])
            );
          });
        })
      )
  );

  program.addCommand(task);
}
