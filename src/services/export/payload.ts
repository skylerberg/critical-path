import type { Kysely } from 'kysely';
import type { DB } from '../../db/types';
import type { BoardPayload, ProjectExport } from '../../schemas/index';
import { usersWithProjectAccess } from '../authorization';

export const PROJECT_EXPORT_FORMAT = 'critical-path-project-export';
export const PROJECT_EXPORT_VERSION = 1;

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export interface ExportImageRow {
  id: string;
  task_id: string;
  storage_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: Date;
}

// Derived from the image id, never the user-supplied filename, so an archive
// can never carry a traversal path or two entries with the same name.
export function imageArchivePath(id: string, contentType: string): string {
  return `images/${id}.${IMAGE_EXTENSIONS[contentType] ?? 'bin'}`;
}

export async function buildProjectExport(
  db: Kysely<DB>,
  payload: BoardPayload,
  now: Date
): Promise<{ exportPayload: ProjectExport; images: ExportImageRow[] }> {
  const projectId = payload.project.id;

  const [users, images] = await Promise.all([
    usersWithProjectAccess(db, projectId),
    db
      .selectFrom('task_image')
      .innerJoin('task', 'task.id', 'task_image.task_id')
      .select([
        'task_image.id',
        'task_image.task_id',
        'task_image.storage_key',
        'task_image.filename',
        'task_image.content_type',
        'task_image.size_bytes',
        'task_image.created_at',
      ])
      .where('task.project_id', '=', projectId)
      // The manifest is built from the board payload, which has no archived
      // tasks; without this the zip would carry image files nothing references.
      .where('task.archived_at', 'is', null)
      .orderBy('task_image.created_at')
      .orderBy('task_image.id')
      .execute(),
  ]);

  const imagesByTask = new Map<string, ProjectExport['tasks'][number]['images']>();
  for (const image of images) {
    const manifestEntries = imagesByTask.get(image.task_id) ?? [];
    manifestEntries.push({
      id: image.id,
      path: imageArchivePath(image.id, image.content_type),
      filename: image.filename,
      content_type: image.content_type,
      size_bytes: image.size_bytes,
      created_at: image.created_at.toISOString(),
    });
    imagesByTask.set(image.task_id, manifestEntries);
  }

  const exportPayload: ProjectExport = {
    format: PROJECT_EXPORT_FORMAT,
    version: PROJECT_EXPORT_VERSION,
    exported_at: now.toISOString(),
    project: payload.project,
    users: users.map(({ id, email, name }) => ({ id, email, name })),
    columns: payload.columns,
    labels: payload.labels,
    tasks: payload.tasks.map(({ image_count: _imageCount, ...task }) => ({
      ...task,
      images: imagesByTask.get(task.id) ?? [],
    })),
  };

  return { exportPayload, images };
}
