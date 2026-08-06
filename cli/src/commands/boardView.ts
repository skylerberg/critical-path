import { Command } from 'commander';
import { byRank } from '../positions';
import { leaf, withCtx } from '../kit';
import { resolveBoard } from '../resolve';
import { sortedColumns, sortedTasksIn, taskState } from '../board';
import { displayTitle } from '../output';
import type { CliDeps } from '../context';

export function registerBoardViews(program: Command, deps: CliDeps): void {
  program.addCommand(
    leaf('board')
      .description('Show the full board for a project')
      .argument('[project]', 'project id or name (defaults to the configured project)')
      .action(
        withCtx(deps, async (ctx, _opts, projectRef) => {
          const board = await resolveBoard(ctx, projectRef);
          const withState = board.tasks.map((task) => ({
            ...task,
            state: taskState(task, board),
          }));
          ctx.out.data({ ...board, tasks: withState }, () => {
            ctx.out.line(ctx.out.style(['bold'], board.project.name));
            for (const column of sortedColumns(board)) {
              const tasks = sortedTasksIn(board, column.id);
              ctx.out.line();
              ctx.out.line(
                ctx.out.style(['bold'], `${column.name}${column.is_done ? ' (done)' : ''}`)
              );
              if (tasks.length === 0) {
                ctx.out.line('  (empty)');
                continue;
              }
              for (const task of tasks) {
                const state = taskState(task, board);
                const mark =
                  state === 'blocked'
                    ? ctx.out.style(['red'], '[blocked]')
                    : state === 'ready'
                      ? ctx.out.style(['green'], '[ready]  ')
                      : '         ';
                ctx.out.line(`  ${task.id.slice(0, 8)}  ${mark}  ${displayTitle(task.title)}`);
              }
            }
          });
        })
      )
  );

  program.addCommand(
    leaf('ready')
      .description('List tasks that are not done and have no unfinished blockers')
      .option('--project <project>', 'project id or name')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const board = await resolveBoard(ctx, opts.project as string | undefined);
          const columnName = new Map(board.columns.map((c) => [c.id, c.name]));
          const ready = board.tasks
            .filter((task) => taskState(task, board) === 'ready')
            .sort(byRank);
          ctx.out.data(ready, () => {
            if (ready.length === 0) {
              ctx.out.line('No ready tasks');
              return;
            }
            ctx.out.table(
              ['ID', 'COLUMN', 'TITLE'],
              ready.map((t) => [
                t.id.slice(0, 8),
                columnName.get(t.column_id) ?? '',
                displayTitle(t.title),
              ])
            );
          });
        })
      )
  );
}
