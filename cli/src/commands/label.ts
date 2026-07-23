import { Command } from 'commander';
import { leaf, withCtx } from '../kit';
import { CliError, EXIT, assertOk } from '../api/errors';
import { confirmOrAbort } from '../prompt';
import { resolveBoard, resolveLabel } from '../resolve';
import type { CliDeps } from '../context';

export function registerLabel(program: Command, deps: CliDeps): void {
  const label = new Command('label').description('Manage project labels');

  label.addCommand(
    leaf('list')
      .description('List labels')
      .option('--project <ref>', 'project id or name')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const board = await resolveBoard(ctx, opts.project as string | undefined);
          const labels = [...board.labels].sort((a, b) => a.name.localeCompare(b.name));
          ctx.out.data(labels, () => {
            ctx.out.table(
              ['ID', 'NAME', 'COLOR'],
              labels.map((l) => [l.id.slice(0, 8), l.name, l.color])
            );
          });
        })
      )
  );

  label.addCommand(
    leaf('create')
      .description('Create a label')
      .argument('<name>', 'label name')
      .requiredOption('--color <color>', 'hex color like #ff8800')
      .option('--project <ref>', 'project id or name')
      .action(
        withCtx(deps, async (ctx, opts, name) => {
          const board = await resolveBoard(ctx, opts.project as string | undefined);
          const created = assertOk(
            await ctx.api.POST('/api/labels', {
              body: {
                id: crypto.randomUUID(),
                project_id: board.project.id,
                name,
                color: (opts.color as string).toLowerCase(),
              },
            })
          );
          ctx.out.data(created, () =>
            ctx.out.line(`Created label ${created.name} (${created.id.slice(0, 8)})`)
          );
        })
      )
  );

  label.addCommand(
    leaf('update')
      .description('Rename or recolor a label')
      .argument('<label>', 'label id or name')
      .option('--project <ref>', 'project id or name')
      .option('--name <name>', 'new name')
      .option('--color <color>', 'new hex color like #ff8800')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const board = await resolveBoard(ctx, opts.project as string | undefined);
          const target = resolveLabel(board, ref);
          const body: { name?: string; color?: string } = {};
          if (typeof opts.name === 'string') {
            body.name = opts.name;
          }
          if (typeof opts.color === 'string') {
            body.color = opts.color.toLowerCase();
          }
          if (Object.keys(body).length === 0) {
            throw new CliError('Pass --name and/or --color', EXIT.usage);
          }
          const updated = assertOk(
            await ctx.api.PATCH('/api/labels/{id}', {
              params: { path: { id: target.id } },
              body,
            })
          );
          ctx.out.data(updated, () => ctx.out.line(`Updated label ${updated.name}`));
        })
      )
  );

  label.addCommand(
    leaf('delete')
      .description('Delete a label')
      .argument('<label>', 'label id or name')
      .option('--project <ref>', 'project id or name')
      .option('--force', 'skip the confirmation prompt')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const board = await resolveBoard(ctx, opts.project as string | undefined);
          const target = resolveLabel(board, ref);
          await confirmOrAbort(ctx, `Delete label "${target.name}"?`, opts.force === true);
          assertOk(
            await ctx.api.DELETE('/api/labels/{id}', { params: { path: { id: target.id } } })
          );
          ctx.out.data({ deleted: true, id: target.id }, () =>
            ctx.out.line(`Deleted label ${target.name}`)
          );
        })
      )
  );

  program.addCommand(label);
}
