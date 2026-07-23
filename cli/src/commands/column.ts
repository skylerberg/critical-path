import { Command } from 'commander';
import { leaf, withCtx, type Opts } from '../kit';
import { CliError, EXIT, assertOk } from '../api/errors';
import { confirmOrAbort } from '../prompt';
import { resolveBoard, resolveColumn, type BoardPayload } from '../resolve';
import { sortedColumns, sortedTasksIn } from '../board';
import { positionForPlacement, type Placement } from '../positions';
import type { CliDeps, RuntimeContext } from '../context';
import type { components } from '../api/api.generated';

type Column = components['schemas']['Column'];

function placementFrom(opts: Opts): Placement {
  return {
    top: opts.top === true,
    bottom: opts.bottom === true,
    before: opts.before as string | undefined,
    after: opts.after as string | undefined,
  };
}

function hasPlacement(placement: Placement): boolean {
  return (
    placement.top === true ||
    placement.bottom === true ||
    placement.before != null ||
    placement.after != null
  );
}

function addPlacementOptions(command: Command): Command {
  return command
    .option('--top', 'place first')
    .option('--bottom', 'place last')
    .option('--before <column>', 'place before this column (id or name)')
    .option('--after <column>', 'place after this column (id or name)');
}

function columnAnchorResolver(board: BoardPayload, excludeId?: string): (ref: string) => string {
  return (ref) => {
    const anchor = resolveColumn(board, ref);
    if (anchor.id === excludeId) {
      throw new CliError('Cannot move a column relative to itself', EXIT.usage);
    }
    return anchor.id;
  };
}

function printColumn(ctx: RuntimeContext, verb: string, column: Column): void {
  ctx.out.data(column, () =>
    ctx.out.line(`${verb} column ${column.name} (${column.id.slice(0, 8)})`)
  );
}

export function registerColumn(program: Command, deps: CliDeps): void {
  const column = new Command('column').description('Manage board columns');

  column.addCommand(
    leaf('list')
      .description('List columns in position order')
      .option('--project <ref>', 'project id or name')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const board = await resolveBoard(ctx, opts.project as string | undefined);
          const columns = sortedColumns(board).map((c) => ({
            ...c,
            task_count: sortedTasksIn(board, c.id).length,
          }));
          ctx.out.data(columns, () => {
            ctx.out.table(
              ['ID', 'NAME', 'TASKS', 'DONE'],
              columns.map((c) => [
                c.id.slice(0, 8),
                c.name,
                String(c.task_count),
                c.is_done ? 'yes' : '',
              ])
            );
          });
        })
      )
  );

  column.addCommand(
    addPlacementOptions(
      leaf('create')
        .description('Create a column (placed at the bottom by default)')
        .argument('<name>', 'column name')
        .option('--project <ref>', 'project id or name')
        .option('--done', 'tasks in this column count as done')
    ).action(
      withCtx(deps, async (ctx, opts, name) => {
        const board = await resolveBoard(ctx, opts.project as string | undefined);
        const position = positionForPlacement(
          placementFrom(opts),
          sortedColumns(board),
          columnAnchorResolver(board)
        );
        const created = assertOk(
          await ctx.api.POST('/api/columns', {
            body: {
              id: crypto.randomUUID(),
              project_id: board.project.id,
              name,
              position,
              is_done: opts.done === true ? true : undefined,
            },
          })
        );
        printColumn(ctx, 'Created', created);
      })
    )
  );

  column.addCommand(
    leaf('update')
      .description('Rename a column or toggle its done status')
      .argument('<column>', 'column id or name')
      .option('--project <ref>', 'project id or name')
      .option('--name <name>', 'new name')
      .option('--done', 'tasks in this column count as done')
      .option('--no-done', 'tasks in this column do not count as done')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const board = await resolveBoard(ctx, opts.project as string | undefined);
          const target = resolveColumn(board, ref);
          const body: { name?: string; is_done?: boolean } = {};
          if (typeof opts.name === 'string') {
            body.name = opts.name;
          }
          if (typeof opts.done === 'boolean') {
            body.is_done = opts.done;
          }
          if (Object.keys(body).length === 0) {
            throw new CliError('Pass --name and/or --done/--no-done', EXIT.usage);
          }
          const updated = assertOk(
            await ctx.api.PATCH('/api/columns/{id}', {
              params: { path: { id: target.id } },
              body,
            })
          );
          printColumn(ctx, 'Updated', updated);
        })
      )
  );

  column.addCommand(
    addPlacementOptions(
      leaf('move')
        .description('Move a column to a new position')
        .argument('<column>', 'column id or name')
        .option('--project <ref>', 'project id or name')
    ).action(
      withCtx(deps, async (ctx, opts, ref) => {
        const placement = placementFrom(opts);
        if (!hasPlacement(placement)) {
          throw new CliError('Pass one of --top, --bottom, --before, --after', EXIT.usage);
        }
        const board = await resolveBoard(ctx, opts.project as string | undefined);
        const target = resolveColumn(board, ref);
        const others = sortedColumns(board).filter((c) => c.id !== target.id);
        const position = positionForPlacement(
          placement,
          others,
          columnAnchorResolver(board, target.id)
        );
        const updated = assertOk(
          await ctx.api.PATCH('/api/columns/{id}', {
            params: { path: { id: target.id } },
            body: { position },
          })
        );
        printColumn(ctx, 'Moved', updated);
      })
    )
  );

  column.addCommand(
    leaf('delete')
      .description('Delete a column, optionally moving its tasks to another column')
      .argument('<column>', 'column id or name')
      .option('--project <ref>', 'project id or name')
      .option('--move-tasks-to <column>', 'column to receive the deleted tasks')
      .option('--force', 'skip the confirmation prompt')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const board = await resolveBoard(ctx, opts.project as string | undefined);
          const target = resolveColumn(board, ref);
          const tasks = sortedTasksIn(board, target.id);
          const moveTo =
            opts.moveTasksTo == null ? undefined : resolveColumn(board, opts.moveTasksTo as string);
          if (tasks.length > 0 && moveTo == null) {
            throw new CliError(
              `Column "${target.name}" has ${tasks.length} task(s); pass --move-tasks-to <column> to move them`,
              EXIT.conflict
            );
          }
          const suffix =
            tasks.length > 0 && moveTo != null
              ? ` and move its ${tasks.length} task(s) to "${moveTo.name}"`
              : '';
          await confirmOrAbort(
            ctx,
            `Delete column "${target.name}"${suffix}?`,
            opts.force === true
          );
          const result = assertOk(
            await ctx.api.DELETE('/api/columns/{id}', {
              params: {
                path: { id: target.id },
                query: moveTo == null ? {} : { move_tasks_to: moveTo.id },
              },
            })
          );
          const moved = result?.moved_tasks ?? [];
          ctx.out.data({ deleted: true, id: target.id, moved_tasks: moved }, () => {
            const movedNote = moved.length > 0 ? ` (moved ${moved.length} task(s))` : '';
            ctx.out.line(`Deleted column ${target.name}${movedNote}`);
          });
        })
      )
  );

  program.addCommand(column);
}
