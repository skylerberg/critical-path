import type { ProjectExport } from '../../schemas/index';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { storage } from '../storage/index';
import { tasksCsv } from './csv';
import { imageArchivePath, type ExportImageRow } from './payload';
import { ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, zipSizeUpperBound, zipStream, type ZipEntry } from './zip';

const MANIFEST_NAME = 'project.json';
const CSV_NAME = 'tasks.csv';
const TOO_LARGE_MESSAGE =
  'This project is too large to package as a zip archive; export it with ?format=json ' +
  'and fetch the images individually.';

export function exportFilename(projectName: string, now: Date): string {
  const slug =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 60)
      .replace(/^-+|-+$/g, '') || 'project';
  return `${slug}-${now.toISOString().slice(0, 10)}.zip`;
}

function assertArchiveFits(manifest: Buffer, csv: Buffer, images: ExportImageRow[]): void {
  if (images.length + 2 > ZIP_MAX_ENTRIES) {
    throw new AppError(413, TOO_LARGE_MESSAGE);
  }
  const bound = zipSizeUpperBound([
    { name: MANIFEST_NAME, size: manifest.length },
    { name: CSV_NAME, size: csv.length },
    ...images.map((image) => ({
      name: imageArchivePath(image.id, image.content_type),
      size: image.size_bytes,
    })),
  ]);
  if (bound > ZIP_MAX_BYTES) {
    throw new AppError(413, TOO_LARGE_MESSAGE);
  }
}

// Image bytes are already compressed, so deflating them costs CPU for nothing.
async function* archiveEntries(
  manifest: Buffer,
  csv: Buffer,
  images: ExportImageRow[]
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
}

export function projectExportArchive(
  exportPayload: ProjectExport,
  images: ExportImageRow[],
  now: Date
): ReadableStream<Uint8Array> {
  const manifest = Buffer.from(JSON.stringify(exportPayload, null, 2), 'utf8');
  const csv = Buffer.from(tasksCsv(exportPayload), 'utf8');
  // Must throw before the first byte is written; once the body starts streaming
  // the status code is already committed.
  assertArchiveFits(manifest, csv, images);
  return zipStream(archiveEntries(manifest, csv, images), now);
}
