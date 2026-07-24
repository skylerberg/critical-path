import { Command } from 'commander';
import { leaf, withCtx } from '../kit';
import { CliError, EXIT, assertOk } from '../api/errors';
import { confirmOrAbort } from '../prompt';
import { listProjects, listUsers, resolveBoard, resolveProject, resolveUser } from '../resolve';
import { sortedColumns, sortedTasksIn } from '../board';
import type { CliDeps, RuntimeContext } from '../context';
import type { components } from '../api/api.generated';

type Project = components['schemas']['Project'];

async function patchProject(
  ctx: RuntimeContext,
  id: string,
  body: components['schemas']['PatchProject']
): Promise<Project> {
  return assertOk(await ctx.api.PATCH('/api/projects/{id}', { params: { path: { id } }, body }));
}

export function registerProject(program: Command, deps: CliDeps): void {
  const project = new Command('project').description('Manage projects');

  project.addCommand(
    leaf('list')
      .description('List projects (active by default)')
      .option('--archived', 'show archived projects instead of active ones')
      .option('--all', 'show every project')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const all = opts.all === true;
          const archived = opts.archived === true;
          const projects = (await listProjects(ctx)).filter(
            (p) => all || (archived ? p.archived_at != null : p.archived_at == null)
          );
          const showFlags = all || archived;
          ctx.out.data(projects, () => {
            const headers = ['ID', 'NAME', 'OPEN', 'DONE'];
            if (showFlags) {
              headers.push('FLAGS');
            }
            ctx.out.table(
              headers,
              projects.map((p) => {
                const row = [
                  p.id.slice(0, 8),
                  p.name,
                  String(p.open_task_count),
                  String(p.done_task_count),
                ];
                if (showFlags) {
                  row.push(p.archived_at != null ? 'archived' : '');
                }
                return row;
              })
            );
          });
        })
      )
  );

  project.addCommand(
    leaf('create')
      .description('Create a project (default columns, or a deep copy with --from)')
      .argument('<name>', 'project name')
      .option('--description <text>', 'project description')
      .option('--from <project>', 'source project to copy (id or name)')
      .action(
        withCtx(deps, async (ctx, opts, name) => {
          const from = opts.from as string | undefined;
          const source = from == null ? undefined : await resolveProject(ctx, from);
          const board = assertOk(
            await ctx.api.POST('/api/projects', {
              body: {
                id: crypto.randomUUID(),
                name,
                description: opts.description as string | undefined,
                source_project_id: source?.id,
              },
            })
          );
          ctx.out.data(board, () =>
            ctx.out.line(`Created project ${board.project.name} (${board.project.id.slice(0, 8)})`)
          );
        })
      )
  );

  project.addCommand(
    leaf('show')
      .description('Show a project with per-column task counts and labels')
      .argument('<project>', 'project id or name')
      .action(
        withCtx(deps, async (ctx, _opts, ref) => {
          const board = await resolveBoard(ctx, ref);
          ctx.out.data(board, () => {
            const p = board.project;
            ctx.out.line(ctx.out.style(['bold'], p.name));
            ctx.out.line(`ID: ${p.id}`);
            if (p.description !== '') {
              ctx.out.line(`Description: ${p.description}`);
            }
            ctx.out.line(`Created: ${p.created_at}`);
            if (p.archived_at != null) {
              ctx.out.line(`Archived: ${p.archived_at}`);
            }
            ctx.out.line();
            ctx.out.table(
              ['COLUMN', 'TASKS'],
              sortedColumns(board).map((c) => [
                `${c.name}${c.is_done ? ' (done)' : ''}`,
                String(sortedTasksIn(board, c.id).length),
              ])
            );
            if (board.labels.length > 0) {
              ctx.out.line();
              ctx.out.line(`Labels: ${board.labels.map((l) => l.name).join(', ')}`);
            }
          });
        })
      )
  );

  project.addCommand(
    leaf('update')
      .description('Update a project')
      .argument('<project>', 'project id or name')
      .option('--name <name>', 'new name')
      .option('--description <text>', 'new description')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const target = await resolveProject(ctx, ref);
          const body: components['schemas']['PatchProject'] = {};
          if (typeof opts.name === 'string') {
            body.name = opts.name;
          }
          if (typeof opts.description === 'string') {
            body.description = opts.description;
          }
          if (Object.keys(body).length === 0) {
            throw new CliError('Pass at least one of --name, --description', EXIT.usage);
          }
          const updated = await patchProject(ctx, target.id, body);
          ctx.out.data(updated, () => ctx.out.line(`Updated project ${updated.name}`));
        })
      )
  );

  project.addCommand(
    leaf('members')
      .description('List the members of a project (the creator is implicit)')
      .argument('<project>', 'project id or name')
      .action(
        withCtx(deps, async (ctx, _opts, ref) => {
          const target = await resolveProject(ctx, ref);
          const users = new Map((await listUsers(ctx, target.id)).map((u) => [u.id, u]));
          const memberIds =
            target.created_by == null
              ? target.member_ids
              : [target.created_by, ...target.member_ids];
          const members = memberIds.map((id) => {
            const user = users.get(id);
            return {
              id,
              name: user?.name ?? null,
              email: user?.email ?? null,
              role: id === target.created_by ? 'owner' : 'member',
            };
          });
          ctx.out.data(members, () => {
            ctx.out.table(
              ['ID', 'NAME', 'EMAIL', 'ROLE'],
              members.map((m) => [m.id.slice(0, 8), m.name ?? '(unknown)', m.email ?? '', m.role])
            );
          });
        })
      )
  );

  project.addCommand(
    leaf('set-members')
      .description('Replace the member list (the creator always keeps access)')
      .argument('<project>', 'project id or name')
      .argument('<users...>', 'user ids, names, or emails')
      .action(
        withCtx(deps, async (ctx, _opts, ref, ...rest) => {
          const target = await resolveProject(ctx, ref);
          const userRefs = rest.flat();
          const ids: string[] = [];
          for (const userRef of userRefs) {
            const user = await resolveUser(ctx, userRef);
            if (!ids.includes(user.id)) {
              ids.push(user.id);
            }
          }
          assertOk(
            await ctx.api.PUT('/api/projects/{id}/members', {
              params: { path: { id: target.id } },
              body: { user_ids: ids },
            })
          );
          const updated = await resolveProject(ctx, target.id);
          ctx.out.data(updated, () =>
            ctx.out.line(`Set ${updated.member_ids.length} member(s) on project ${updated.name}`)
          );
        })
      )
  );

  project.addCommand(
    leaf('invite')
      .description('Add a member by email')
      .argument('<project>', 'project id or name')
      .requiredOption('--email <email>', 'email of the user to add')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const target = await resolveProject(ctx, ref);
          const { user } = assertOk(
            await ctx.api.POST('/api/projects/{id}/members/by-email', {
              params: { path: { id: target.id } },
              body: { email: opts.email as string },
            })
          );
          ctx.out.data(user, () =>
            ctx.out.line(`Added ${user.name} <${user.email}> to project ${target.name}`)
          );
        })
      )
  );

  project.addCommand(
    leaf('archive')
      .description('Archive a project')
      .argument('<project>', 'project id or name')
      .action(
        withCtx(deps, async (ctx, _opts, ref) => {
          const target = await resolveProject(ctx, ref);
          const updated = await patchProject(ctx, target.id, {
            archived_at: new Date().toISOString(),
          });
          ctx.out.data(updated, () => ctx.out.line(`Archived project ${updated.name}`));
        })
      )
  );

  project.addCommand(
    leaf('unarchive')
      .description('Unarchive a project')
      .argument('<project>', 'project id or name')
      .action(
        withCtx(deps, async (ctx, _opts, ref) => {
          const target = await resolveProject(ctx, ref);
          const updated = await patchProject(ctx, target.id, { archived_at: null });
          ctx.out.data(updated, () => ctx.out.line(`Unarchived project ${updated.name}`));
        })
      )
  );

  project.addCommand(
    leaf('delete')
      .description('Delete a project and everything in it')
      .argument('<project>', 'project id or name')
      .option('--force', 'skip the confirmation prompt')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const target = await resolveProject(ctx, ref);
          await confirmOrAbort(
            ctx,
            `Delete project "${target.name}" and all of its tasks?`,
            opts.force === true
          );
          assertOk(
            await ctx.api.DELETE('/api/projects/{id}', { params: { path: { id: target.id } } })
          );
          ctx.out.data({ deleted: true, id: target.id }, () =>
            ctx.out.line(`Deleted project ${target.name}`)
          );
        })
      )
  );

  program.addCommand(project);
}
