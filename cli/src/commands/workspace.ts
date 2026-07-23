import { Command } from 'commander';
import { leaf, withCtx } from '../kit';
import { assertOk } from '../api/errors';
import { confirmOrAbort } from '../prompt';
import { listUsers, resolveUser, resolveWorkspace } from '../resolve';
import type { CliDeps } from '../context';

export function registerWorkspace(program: Command, deps: CliDeps): void {
  const workspace = new Command('workspace').description('Manage workspaces');

  workspace.addCommand(
    leaf('list')
      .description('List workspaces')
      .action(
        withCtx(deps, async (ctx) => {
          const { workspaces } = assertOk(await ctx.api.GET('/api/workspaces'));
          ctx.out.data(workspaces, () => {
            ctx.out.table(
              ['ID', 'NAME', 'MEMBERS'],
              workspaces.map((w) => [w.id.slice(0, 8), w.name, String(w.member_ids.length)])
            );
          });
        })
      )
  );

  workspace.addCommand(
    leaf('create')
      .description('Create a workspace')
      .argument('<name>', 'workspace name')
      .action(
        withCtx(deps, async (ctx, _opts, name) => {
          const created = assertOk(
            await ctx.api.POST('/api/workspaces', { body: { id: crypto.randomUUID(), name } })
          );
          ctx.out.data(created, () =>
            ctx.out.line(`Created workspace ${created.name} (${created.id.slice(0, 8)})`)
          );
        })
      )
  );

  workspace.addCommand(
    leaf('rename')
      .description('Rename a workspace')
      .argument('<workspace>', 'workspace id or name')
      .argument('<name>', 'new name')
      .action(
        withCtx(deps, async (ctx, _opts, ref, name) => {
          const target = await resolveWorkspace(ctx, ref);
          const updated = assertOk(
            await ctx.api.PATCH('/api/workspaces/{id}', {
              params: { path: { id: target.id } },
              body: { name },
            })
          );
          ctx.out.data(updated, () => ctx.out.line(`Renamed workspace to ${updated.name}`));
        })
      )
  );

  workspace.addCommand(
    leaf('delete')
      .description('Delete a workspace')
      .argument('<workspace>', 'workspace id or name')
      .option('--force', 'skip the confirmation prompt')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const target = await resolveWorkspace(ctx, ref);
          await confirmOrAbort(ctx, `Delete workspace "${target.name}"?`, opts.force === true);
          assertOk(
            await ctx.api.DELETE('/api/workspaces/{id}', { params: { path: { id: target.id } } })
          );
          ctx.out.data({ deleted: true, id: target.id }, () =>
            ctx.out.line(`Deleted workspace ${target.name}`)
          );
        })
      )
  );

  workspace.addCommand(
    leaf('members')
      .description('List the members of a workspace')
      .argument('<workspace>', 'workspace id or name')
      .action(
        withCtx(deps, async (ctx, _opts, ref) => {
          const target = await resolveWorkspace(ctx, ref);
          const users = new Map((await listUsers(ctx)).map((u) => [u.id, u]));
          const members = target.member_ids.map((id) => {
            const user = users.get(id);
            return { id, name: user?.name ?? null, email: user?.email ?? null };
          });
          ctx.out.data(members, () => {
            ctx.out.table(
              ['ID', 'NAME', 'EMAIL'],
              members.map((m) => [m.id.slice(0, 8), m.name ?? '(unknown)', m.email ?? ''])
            );
          });
        })
      )
  );

  workspace.addCommand(
    leaf('set-members')
      .description('Replace the member list (must include yourself)')
      .argument('<workspace>', 'workspace id or name')
      .argument('<users...>', 'user ids, names, or emails')
      .action(
        withCtx(deps, async (ctx, _opts, ref, ...rest) => {
          const target = await resolveWorkspace(ctx, ref);
          const userRefs = rest.flat();
          const ids: string[] = [];
          for (const userRef of userRefs) {
            const user = await resolveUser(ctx, userRef);
            if (!ids.includes(user.id)) {
              ids.push(user.id);
            }
          }
          assertOk(
            await ctx.api.PUT('/api/workspaces/{id}/members', {
              params: { path: { id: target.id } },
              body: { user_ids: ids },
            })
          );
          const updated = await resolveWorkspace(ctx, target.id);
          ctx.out.data(updated, () =>
            ctx.out.line(`Set ${updated.member_ids.length} member(s) on workspace ${updated.name}`)
          );
        })
      )
  );

  workspace.addCommand(
    leaf('invite')
      .description('Add a member by email')
      .argument('<workspace>', 'workspace id or name')
      .requiredOption('--email <email>', 'email of the user to add')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const target = await resolveWorkspace(ctx, ref);
          const { user } = assertOk(
            await ctx.api.POST('/api/workspaces/{id}/members/by-email', {
              params: { path: { id: target.id } },
              body: { email: opts.email as string },
            })
          );
          ctx.out.data(user, () =>
            ctx.out.line(`Added ${user.name} <${user.email}> to workspace ${target.name}`)
          );
        })
      )
  );

  program.addCommand(workspace);
}
