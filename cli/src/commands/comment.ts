import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { leaf, withCtx, type Opts } from '../kit';
import { CliError, EXIT, assertOk } from '../api/errors';
import { confirmOrAbort, readAllStdin } from '../prompt';
import { listUsers, resolveTaskId } from '../resolve';
import { markdownToTiptap, tiptapToMarkdown, type TiptapDoc } from '../markdown';
import type { CliDeps, RuntimeContext } from '../context';

function bodyLeaf(name: string, mentions: string): Command {
  return leaf(name).option(
    '--body-file <path>',
    `read the Markdown body from a file (- for stdin, ${mentions})`
  );
}

async function bodyFrom(
  ctx: RuntimeContext,
  opts: Opts,
  positional: string | undefined
): Promise<TiptapDoc> {
  const bodyFile = opts.bodyFile as string | undefined;
  if ((positional === undefined) === (bodyFile === undefined)) {
    throw new CliError('Pass exactly one of a body argument or --body-file', EXIT.usage);
  }
  if (positional !== undefined) {
    return markdownToTiptap(positional);
  }
  const markdown = bodyFile === '-' ? await readAllStdin(ctx) : await readFile(bodyFile!, 'utf8');
  return markdownToTiptap(markdown);
}

export function registerComment(program: Command, deps: CliDeps): void {
  const comment = new Command('comment').description('Manage task comments');

  comment.addCommand(
    leaf('list')
      .description('List the comments on a task, oldest first')
      .argument('<task>', 'task id or title')
      .option('--project <project>', 'project id or name (needed for task refs that are not ids)')
      .action(
        withCtx(deps, async (ctx, opts, taskRef) => {
          const taskId = await resolveTaskId(ctx, taskRef, opts.project as string | undefined);
          const detail = assertOk(
            await ctx.api.GET('/api/tasks/{id}', { params: { path: { id: taskId } } })
          );
          const users = detail.comments.length > 0 ? await listUsers(ctx, detail.project_id) : [];
          const userById = new Map(users.map((u) => [u.id, u]));
          ctx.out.data(detail.comments, () => {
            if (detail.comments.length === 0) {
              ctx.out.line('No comments');
              return;
            }
            // Bodies are multi-line, so a table cannot hold them; the id is printed
            // in full because edit and delete take a whole uuid.
            for (const item of detail.comments) {
              const author = userById.get(item.user_id);
              const who = author == null ? item.user_id : `${author.name} <${author.email}>`;
              const edited = item.updated_at === item.created_at ? '' : ' (edited)';
              ctx.out.line(`${item.id}  ${who}  ${item.created_at}${edited}`);
              ctx.out.line(tiptapToMarkdown(item.body));
              ctx.out.line();
            }
          });
        })
      )
  );

  comment.addCommand(
    bodyLeaf('add', 'no mentions')
      .description('Post a comment on a task')
      .argument('<task>', 'task id or title')
      .argument('[body]', 'comment body as Markdown (no mentions)')
      .option('--project <project>', 'project id or name (needed for task refs that are not ids)')
      .action(
        withCtx(deps, async (ctx, opts, taskRef, body) => {
          const doc = await bodyFrom(ctx, opts, body);
          const taskId = await resolveTaskId(ctx, taskRef, opts.project as string | undefined);
          const created = assertOk(
            await ctx.api.POST('/api/comments', {
              body: { id: crypto.randomUUID(), task_id: taskId, body: doc },
            })
          );
          ctx.out.data(created, () => ctx.out.line(`Added comment ${created.id}`));
        })
      )
  );

  comment.addCommand(
    bodyLeaf('edit', 'drops any @mentions')
      .description('Replace the body of one of your own comments')
      .argument('<commentId>', 'comment id (from comment list)')
      .argument('[body]', 'new comment body as Markdown (drops any @mentions)')
      .action(
        withCtx(deps, async (ctx, opts, commentId, body) => {
          const doc = await bodyFrom(ctx, opts, body);
          const updated = assertOk(
            await ctx.api.PATCH('/api/comments/{id}', {
              params: { path: { id: commentId } },
              body: { body: doc },
            })
          );
          ctx.out.data(updated, () => ctx.out.line(`Updated comment ${updated.id}`));
        })
      )
  );

  comment.addCommand(
    leaf('delete')
      .description('Delete one of your own comments')
      .argument('<commentId>', 'comment id (from comment list)')
      .option('--force', 'skip the confirmation prompt')
      .action(
        withCtx(deps, async (ctx, opts, commentId) => {
          await confirmOrAbort(ctx, `Delete comment ${commentId}?`, opts.force === true);
          assertOk(
            await ctx.api.DELETE('/api/comments/{id}', { params: { path: { id: commentId } } })
          );
          ctx.out.data({ deleted: true, id: commentId }, () => ctx.out.line('Deleted'));
        })
      )
  );

  program.addCommand(comment);
}
