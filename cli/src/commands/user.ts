import { Command } from 'commander';
import { leaf, withCtx } from '../kit';
import { listUsers, resolveProject, searchUsers } from '../resolve';
import type { CliDeps } from '../context';

export function registerUser(program: Command, deps: CliDeps): void {
  const user = new Command('user').description('List and search users');

  user.addCommand(
    leaf('list')
      .description('List visible users, optionally scoped to a project')
      .option('--project <project>', 'project id or name')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const projectRef = opts.project as string | undefined;
          const projectId =
            projectRef == null ? undefined : (await resolveProject(ctx, projectRef)).id;
          const users = await listUsers(ctx, projectId);
          ctx.out.data(users, () => {
            ctx.out.table(
              ['ID', 'NAME'],
              users.map((u) => [u.id.slice(0, 8), u.name])
            );
          });
        })
      )
  );

  user.addCommand(
    leaf('search')
      .description('Find people you do not already share a project with, by name')
      .argument('<query>', 'a name, or the first characters of one')
      .action(
        withCtx(deps, async (ctx, _opts, query: string) => {
          const { users, truncated } = await searchUsers(ctx, query);
          ctx.out.data({ users, truncated }, () => {
            ctx.out.table(
              ['ID', 'NAME'],
              users.map((u) => [u.id.slice(0, 8), u.name])
            );
            if (truncated) {
              ctx.out.line(
                ctx.out.style(['dim'], 'More matched than are shown; narrow the query to see them.')
              );
            }
          });
        })
      )
  );

  program.addCommand(user);
}
