import { Command } from 'commander';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { leaf, withCtx } from '../kit';
import { assertOk } from '../api/errors';
import { resolveTaskId } from '../resolve';
import { confirmOrAbort } from '../prompt';
import type { CliDeps } from '../context';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function describe(kind: string, filename: string | null, url: string | null): string {
  if (kind === 'link') return url ?? '';
  return filename ?? '';
}

export function registerAttachment(program: Command, deps: CliDeps): void {
  const attachment = new Command('attachment')
    .alias('att')
    .description('Manage task attachments: files, links and images');

  attachment.addCommand(
    leaf('upload')
      .description('Attach a file to a task; an image is stored as one automatically')
      .argument('<task>', 'task id or title')
      .argument('<file>', 'path to the file')
      .option(
        '--project <project>',
        'project id or name (needed for task refs that are not full ids)'
      )
      .action(
        withCtx(deps, async (ctx, opts, taskRef, filePath) => {
          const info = await stat(filePath);
          const taskId = await resolveTaskId(ctx, taskRef, opts.project as string | undefined);
          // Streamed rather than read into memory: the server caps a file at
          // 50 MB, and holding one here to send it would be the only place in
          // this path that could not.
          const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
          const uploaded = assertOk(
            await ctx.api.POST('/api/attachments/files', {
              params: {
                query: {
                  task_id: taskId,
                  filename: basename(filePath),
                  content_type: 'application/octet-stream',
                },
              },
              body: '',
              bodySerializer: () => body,
              headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(info.size),
              },
              duplex: 'half',
            })
          );
          ctx.out.data(uploaded, () =>
            ctx.out.line(
              `Uploaded ${uploaded.filename ?? basename(filePath)} as ${uploaded.id} (${uploaded.kind})`
            )
          );
        })
      )
  );

  attachment.addCommand(
    leaf('link')
      .description('Attach a URL to a task')
      .argument('<task>', 'task id or title')
      .argument('<url>', 'http or https URL')
      .option('--title <title>', 'display title (otherwise the unfurled page title is used)')
      .option(
        '--project <project>',
        'project id or name (needed for task refs that are not full ids)'
      )
      .action(
        withCtx(deps, async (ctx, opts, taskRef, url) => {
          const taskId = await resolveTaskId(ctx, taskRef, opts.project as string | undefined);
          const created = assertOk(
            await ctx.api.POST('/api/attachments/links', {
              body: {
                id: crypto.randomUUID(),
                task_id: taskId,
                url,
                ...(opts.title === undefined ? {} : { title: opts.title as string }),
              },
            })
          );
          // The page is fetched in the background, so the title and preview are
          // usually not here yet.
          ctx.out.data(created, () =>
            ctx.out.line(
              `Linked ${created.url ?? url} as ${created.id} (${created.unfurl_state ?? 'pending'})`
            )
          );
        })
      )
  );

  attachment.addCommand(
    leaf('list')
      .description('List everything attached to a task')
      .argument('<task>', 'task id or title')
      .option('--kind <kind>', 'only file, link or image')
      .option(
        '--project <project>',
        'project id or name (needed for task refs that are not full ids)'
      )
      .action(
        withCtx(deps, async (ctx, opts, taskRef) => {
          const taskId = await resolveTaskId(ctx, taskRef, opts.project as string | undefined);
          const detail = assertOk(
            await ctx.api.GET('/api/tasks/{id}', { params: { path: { id: taskId } } })
          );
          const kind = opts.kind as string | undefined;
          const rows = (detail.attachments ?? []).filter(
            (entry) => kind === undefined || entry.kind === kind
          );
          ctx.out.data(rows, () => {
            if (rows.length === 0) {
              ctx.out.line('Nothing attached');
              return;
            }
            ctx.out.table(
              ['ID', 'KIND', 'NAME', 'TYPE', 'BYTES', 'COVER'],
              rows.map((entry) => [
                entry.id,
                entry.kind,
                entry.title ?? describe(entry.kind, entry.filename, entry.url),
                entry.content_type ?? '',
                entry.size_bytes === null ? '' : String(entry.size_bytes),
                entry.is_cover ? 'yes' : '',
              ])
            );
          });
        })
      )
  );

  attachment.addCommand(
    leaf('download')
      .description('Download an attachment by id; a link has no bytes to fetch')
      .argument('<attachmentId>', 'attachment id (from attachment list)')
      .option('-o, --output <file>', 'output path (default <id>.<ext>)')
      .action(
        withCtx(deps, async (ctx, opts, attachmentId) => {
          // A file and an image are served by different routes, and the id alone
          // does not say which this is. Asking the file route first and falling
          // back costs one 404 and keeps this a read: the only endpoint that
          // would report the kind outright is PATCH, and reading through a
          // mutation is worse than a wasted request.
          let result = await ctx.api.GET('/api/attachments/{id}/download', {
            params: { path: { id: attachmentId } },
            parseAs: 'arrayBuffer',
          });
          if (result.response.status === 404) {
            result = await ctx.api.GET('/api/images/{id}', {
              params: { path: { id: attachmentId } },
              parseAs: 'arrayBuffer',
            });
          }
          const bytes = assertOk(result);
          const contentType = result.response.headers.get('content-type') ?? '';
          const disposition = result.response.headers.get('content-disposition') ?? '';
          const named = /filename="([^"]+)"/.exec(disposition)?.[1];
          const target =
            (opts.output as string | undefined) ??
            named ??
            `${attachmentId}.${IMAGE_EXTENSIONS[contentType] ?? 'bin'}`;
          await writeFile(target, Buffer.from(bytes));
          ctx.out.data(
            { path: target, size_bytes: bytes.byteLength, content_type: contentType },
            () => ctx.out.line(`Wrote ${target} (${String(bytes.byteLength)} bytes)`)
          );
        })
      )
  );

  attachment.addCommand(
    leaf('rename')
      .description('Set an attachment’s display title, which never changes its filename')
      .argument('<attachmentId>', 'attachment id (from attachment list)')
      .argument('<title>', 'new title')
      .action(
        withCtx(deps, async (ctx, _opts, attachmentId, title) => {
          const updated = assertOk(
            await ctx.api.PATCH('/api/attachments/{id}', {
              params: { path: { id: attachmentId } },
              body: { title },
            })
          );
          ctx.out.data(updated, () => ctx.out.line(`Renamed to ${updated.title ?? title}`));
        })
      )
  );

  attachment.addCommand(
    leaf('delete')
      .description('Delete an attachment by id')
      .argument('<attachmentId>', 'attachment id (from attachment list)')
      .option('--force', 'skip the confirmation prompt')
      .action(
        withCtx(deps, async (ctx, opts, attachmentId) => {
          await confirmOrAbort(ctx, `Delete attachment ${attachmentId}?`, opts.force === true);
          assertOk(
            await ctx.api.DELETE('/api/attachments/{id}', {
              params: { path: { id: attachmentId } },
            })
          );
          ctx.out.data({ deleted: attachmentId }, () => ctx.out.line('Deleted'));
        })
      )
  );

  program.addCommand(attachment);
}
