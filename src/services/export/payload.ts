import type { Kysely } from 'kysely';
import type { DB } from '../../db/types';
import type { BoardPayload, BoardTask, ProjectExport } from '../../schemas/index';
import { usersWithProjectAccess } from '../authorization';
import { getArchivedTasks } from '../boardPayload';

export const PROJECT_EXPORT_FORMAT = 'critical-path-project-export';
export const PROJECT_EXPORT_VERSION = 3;

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

  const [users, archivedTasks, images, checklistItems] = await Promise.all([
    usersWithProjectAccess(db, projectId),
    getArchivedTasks(db, projectId),
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
      .orderBy('task_image.created_at')
      .orderBy('task_image.id')
      .execute(),
    // No archived_at filter: the manifest lists archived cards too, and filtering
    // would silently drop their items.
    db
      .selectFrom('checklist_item')
      .innerJoin('task', 'task.id', 'checklist_item.task_id')
      .select([
        'checklist_item.id',
        'checklist_item.task_id',
        'checklist_item.text',
        'checklist_item.checked',
        'checklist_item.position',
      ])
      .where('task.project_id', '=', projectId)
      .orderBy('checklist_item.position')
      .orderBy('checklist_item.id')
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

  const checklistByTask = new Map<string, ProjectExport['tasks'][number]['checklist_items']>();
  for (const item of checklistItems) {
    const items = checklistByTask.get(item.task_id) ?? [];
    items.push({
      id: item.id,
      text: item.text,
      checked: item.checked,
      position: item.position,
    });
    checklistByTask.set(item.task_id, items);
  }

  const exportTask = (
    { image_count: _imageCount, ...task }: BoardTask,
    archived_at: string | null
  ): ProjectExport['tasks'][number] => ({
    ...task,
    archived_at,
    images: imagesByTask.get(task.id) ?? [],
    checklist_items: checklistByTask.get(task.id) ?? [],
  });

  const exportPayload: ProjectExport = {
    format: PROJECT_EXPORT_FORMAT,
    version: PROJECT_EXPORT_VERSION,
    exported_at: now.toISOString(),
    project: payload.project,
    users: users.map(({ id, name }) => ({ id, name })),
    columns: payload.columns,
    labels: payload.labels,
    // Archived cards trail the live ones instead of merging into them: they keep
    // the position they were archived at, which a live card may since have taken.
    tasks: [
      ...payload.tasks.map((task) => exportTask(task, null)),
      ...archivedTasks.map(({ archived_at, ...task }) => exportTask(task, archived_at)),
    ],
  };

  return { exportPayload, images };
}
