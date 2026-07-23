import { Command } from 'commander';
import { leaf, withCtx } from '../kit';
import { listUsers, resolveProject } from '../resolve';
import type { CliDeps } from '../context';

export function registerUser(program: Command, deps: CliDeps): void {
  const user = new Command('user').description('List users');

  user.addCommand(
    leaf('list')
      .description('List visible users, optionally scoped to a project')
      .option('--project <ref>', 'project id or name')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const projectRef = opts.project as string | undefined;
          const projectId =
            projectRef == null ? undefined : (await resolveProject(ctx, projectRef)).id;
          const users = await listUsers(ctx, projectId);
          ctx.out.data(users, () => {
            ctx.out.table(
              ['ID', 'NAME', 'EMAIL'],
              users.map((u) => [u.id.slice(0, 8), u.name, u.email])
            );
          });
        })
      )
  );

  program.addCommand(user);
}
