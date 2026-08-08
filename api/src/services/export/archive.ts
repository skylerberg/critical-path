import type { ProjectExport } from '../../schemas/index';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { storage } from '../storage/index';
import { tasksCsv } from './csv';
import { type ExportAttachmentRow } from './payload';
import { ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, zipSizeUpperBound, zipStream, type ZipEntry } from './zip';

const MANIFEST_NAME = 'project.json';
const CSV_NAME = 'tasks.csv';
const TOO_LARGE_MESSAGE =
  'This project is too large to package as a zip archive. Export it with ?format=json, ' +
  'which carries no stored bytes, and fetch each entry the manifest lists under ' +
  'tasks[].attachments[]: one whose kind is image from GET /api/images/<id>, and any other ' +
  'from GET /api/attachments/<id>/download.';

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
  attachments: ExportAttachmentRow[]
): void {
  if (attachments.length + 2 > ZIP_MAX_ENTRIES) {
    throw new AppError(413, TOO_LARGE_MESSAGE);
  }
  const bound = zipSizeUpperBound([
    { name: MANIFEST_NAME, size: manifest.length },
    { name: CSV_NAME, size: csv.length },
    ...attachments.map((attachment) => ({
      name: attachment.path,
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
  attachments: ExportAttachmentRow[]
): AsyncGenerator<ZipEntry> {
  yield { name: MANIFEST_NAME, data: manifest, deflate: true };
  yield { name: CSV_NAME, data: csv, deflate: true };

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
    yield { name: attachment.path, data, deflate: false };
  }
}

export function projectExportArchive(
  exportPayload: ProjectExport,
  attachments: ExportAttachmentRow[],
  now: Date
): ReadableStream<Uint8Array> {
  const manifest = Buffer.from(JSON.stringify(exportPayload, null, 2), 'utf8');
  const csv = Buffer.from(tasksCsv(exportPayload), 'utf8');
  // Must throw before the first byte is written; once the body starts streaming
  // the status code is already committed.
  assertArchiveFits(manifest, csv, attachments);
  return zipStream(archiveEntries(manifest, csv, attachments), now);
}
