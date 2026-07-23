import { Command } from 'commander';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { leaf, withCtx } from '../kit';
import { CliError, EXIT, assertOk } from '../api/errors';
import { resolveTaskId } from '../resolve';
import { confirmOrAbort } from '../prompt';
import type { CliDeps } from '../context';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function registerImage(program: Command, deps: CliDeps): void {
  const image = new Command('image').description('Manage task images');

  image.addCommand(
    leaf('upload')
      .description('Attach an image (png/jpeg/gif/webp, max 10 MB) to a task')
      .argument('<task>', 'task id or title')
      .argument('<file>', 'path to the image file')
      .option('--project <ref>', 'project id or name (needed for task refs that are not full ids)')
      .action(
        withCtx(deps, async (ctx, opts, taskRef, filePath) => {
          const info = await stat(filePath);
          if (info.size > MAX_UPLOAD_BYTES) {
            throw new CliError(
              `File is ${String(info.size)} bytes; the limit is 10 MB`,
              EXIT.invalid
            );
          }
          const taskId = await resolveTaskId(ctx, taskRef, opts.project as string | undefined);
          const contents = await readFile(filePath);
          const form = new FormData();
          form.append('file', new Blob([contents]), basename(filePath));
          const uploaded = assertOk(
            await ctx.api.POST('/api/tasks/{id}/images', {
              params: { path: { id: taskId } },
              body: { file: '' },
              bodySerializer: () => form,
            })
          );
          ctx.out.data(uploaded, () =>
            ctx.out.line(`Uploaded ${uploaded.filename} as ${uploaded.id}`)
          );
        })
      )
  );

  image.addCommand(
    leaf('list')
      .description('List the images attached to a task')
      .argument('<task>', 'task id or title')
      .option('--project <ref>', 'project id or name (needed for task refs that are not full ids)')
      .action(
        withCtx(deps, async (ctx, opts, taskRef) => {
          const taskId = await resolveTaskId(ctx, taskRef, opts.project as string | undefined);
          const detail = assertOk(
            await ctx.api.GET('/api/tasks/{id}', { params: { path: { id: taskId } } })
          );
          ctx.out.data(detail.images, () => {
            if (detail.images.length === 0) {
              ctx.out.line('No images');
              return;
            }
            ctx.out.table(
              ['ID', 'FILENAME', 'TYPE', 'BYTES'],
              detail.images.map((img) => [
                img.id,
                img.filename,
                img.content_type,
                String(img.size_bytes),
              ])
            );
          });
        })
      )
  );

  image.addCommand(
    leaf('download')
      .description('Download an image by id')
      .argument('<imageId>', 'image id (from image list)')
      .option('-o, --output <file>', 'output path (default <id>.<ext>)')
      .action(
        withCtx(deps, async (ctx, opts, imageId) => {
          const result = await ctx.api.GET('/api/images/{id}', {
            params: { path: { id: imageId } },
            parseAs: 'arrayBuffer',
          });
          const bytes = assertOk(result);
          const contentType = result.response.headers.get('content-type') ?? '';
          const target =
            (opts.output as string | undefined) ?? `${imageId}.${EXTENSIONS[contentType] ?? 'bin'}`;
          await writeFile(target, Buffer.from(bytes));
          ctx.out.data(
            { path: target, size_bytes: bytes.byteLength, content_type: contentType },
            () => ctx.out.line(`Wrote ${target} (${String(bytes.byteLength)} bytes)`)
          );
        })
      )
  );

  image.addCommand(
    leaf('delete')
      .description('Delete an image by id')
      .argument('<imageId>', 'image id (from image list)')
      .option('--force', 'skip the confirmation prompt')
      .action(
        withCtx(deps, async (ctx, opts, imageId) => {
          await confirmOrAbort(ctx, `Delete image ${imageId}?`, opts.force === true);
          assertOk(await ctx.api.DELETE('/api/images/{id}', { params: { path: { id: imageId } } }));
          ctx.out.data({ deleted: imageId }, () => ctx.out.line('Deleted'));
        })
      )
  );

  program.addCommand(image);
}
