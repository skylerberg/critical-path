import type { ProjectExport } from '../../schemas/index';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { storage } from '../storage/index';
import { tasksCsv } from './csv';
import {
  attachmentArchivePath,
  imageArchivePath,
  type ExportAttachmentRow,
  type ExportImageRow,
} from './payload';
import { ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, zipSizeUpperBound, zipStream, type ZipEntry } from './zip';

const MANIFEST_NAME = 'project.json';
const CSV_NAME = 'tasks.csv';
const TOO_LARGE_MESSAGE =
  'This project is too large to package as a zip archive. Export it with ?format=json, ' +
  'which carries no image bytes, and fetch each one from GET /api/images/<id> using the ids ' +
  'in tasks[].images[]. File attachments work the same way: the JSON export lists them under ' +
  'tasks[].attachments[] and each one is fetched from GET /api/attachments/<id>/download.';

export function exportFilename(projectName: string, now: Date): string {
  const slug =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 60)
      .replace(/^-+|-+$/g, '') || 'project';
  return `${slug}-${now.toISOString().slice(0, 10)}.zip`;
}

function assertArchiveFits(
  manifest: Buffer,
  csv: Buffer,
  images: ExportImageRow[],
  attachments: ExportAttachmentRow[]
): void {
  if (images.length + attachments.length + 2 > ZIP_MAX_ENTRIES) {
    throw new AppError(413, TOO_LARGE_MESSAGE);
  }
  const bound = zipSizeUpperBound([
    { name: MANIFEST_NAME, size: manifest.length },
    { name: CSV_NAME, size: csv.length },
    ...images.map((image) => ({
      name: imageArchivePath(image.id, image.content_type),
      size: image.size_bytes,
    })),
    ...attachments.map((attachment) => ({
      name: attachmentArchivePath(attachment.id, attachment.filename),
      size: attachment.size_bytes,
    })),
  ]);
  if (bound > ZIP_MAX_BYTES) {
    throw new AppError(413, TOO_LARGE_MESSAGE);
  }
}

// Image bytes are already compressed, so deflating them costs CPU for nothing;
// attachment bytes are arbitrary and just as likely to be an archive already.
async function* archiveEntries(
  manifest: Buffer,
  csv: Buffer,
  images: ExportImageRow[],
  attachments: ExportAttachmentRow[]
): AsyncGenerator<ZipEntry> {
  yield { name: MANIFEST_NAME, data: manifest, deflate: true };
  yield { name: CSV_NAME, data: csv, deflate: true };

  for (const image of images) {
    const data = await storage.get(image.storage_key);
    if (!data) {
      logger.warn({
        msg: 'Image row exists but storage object is missing',
        imageId: image.id,
        storageKey: image.storage_key,
      });
      continue;
    }
    yield { name: imageArchivePath(image.id, image.content_type), data, deflate: false };
  }

  for (const attachment of attachments) {
    const data = await storage.get(attachment.storage_key);
    if (!data) {
      logger.warn({
        msg: 'Attachment row exists but storage object is missing',
        attachmentId: attachment.id,
        storageKey: attachment.storage_key,
      });
      continue;
    }
    yield {
      name: attachmentArchivePath(attachment.id, attachment.filename),
      data,
      deflate: false,
    };
  }
}

export function projectExportArchive(
  exportPayload: ProjectExport,
  images: ExportImageRow[],
  attachments: ExportAttachmentRow[],
  now: Date
): ReadableStream<Uint8Array> {
  const manifest = Buffer.from(JSON.stringify(exportPayload, null, 2), 'utf8');
  const csv = Buffer.from(tasksCsv(exportPayload), 'utf8');
  // Must throw before the first byte is written; once the body starts streaming
  // the status code is already committed.
  assertArchiveFits(manifest, csv, images, attachments);
  return zipStream(archiveEntries(manifest, csv, images, attachments), now);
}
