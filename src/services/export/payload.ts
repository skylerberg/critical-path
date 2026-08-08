import type { Kysely } from 'kysely';
import type { DB } from '../../db/types';
import type { BoardPayload, BoardTask, ProjectExport } from '../../schemas/index';
import { usersWithProjectAccess } from '../userDirectory';
import { IMAGE_KIND } from '../attachments/index';
import { getArchivedTasks } from '../boardPayload';

const PROJECT_EXPORT_FORMAT = 'critical-path-project-export';
const PROJECT_EXPORT_VERSION = 4;

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

// One folder for every entry that owns bytes, because the manifest is now one
// list. Derived from the id, never the user-supplied filename, so an archive can
// never carry a traversal path or two entries with the same name.
export function imageArchivePath(id: string, contentType: string): string {
  return `attachments/${id}.${IMAGE_EXTENSIONS[contentType] ?? 'bin'}`;
}

// Carries the archive path the manifest declared rather than letting the zip
// builder derive its own: images and files name their bytes by different rules,
// and a second derivation is a second chance for the two to disagree.
export interface ExportAttachmentRow {
  id: string;
  task_id: string;
  storage_key: string;
  path: string;
  size_bytes: number;
}

// Same rule and same reason as imageArchivePath: only the extension comes from
// the filename, and only after it survives a shape check.
export function attachmentArchivePath(id: string, filename: string): string {
  const segments = filename.split('.');
  const candidate = segments.length > 1 ? segments[segments.length - 1].toLowerCase() : '';
  const extension = /^[a-z0-9]{1,8}$/.test(candidate) ? candidate : 'bin';
  return `attachments/${id}.${extension}`;
}

export async function buildProjectExport(
  db: Kysely<DB>,
  payload: BoardPayload,
  now: Date
): Promise<{
  exportPayload: ProjectExport;
  attachments: ExportAttachmentRow[];
}> {
  const projectId = payload.project.id;

  const [users, archivedTasks, checklistItems, attachmentRows] = await Promise.all([
    usersWithProjectAccess(db, projectId),
    getArchivedTasks(db, projectId),
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
        'checklist_item.sort_key',
      ])
      .where('task.project_id', '=', projectId)
      .orderBy('checklist_item.sort_key')
      .orderBy('checklist_item.id')
      .execute(),
    db
      .selectFrom('task_attachment')
      .innerJoin('task', 'task.id', 'task_attachment.task_id')
      .select([
        'task_attachment.id',
        'task_attachment.task_id',
        'task_attachment.kind',
        'task_attachment.title',
        'task_attachment.description',
        'task_attachment.filename',
        'task_attachment.content_type',
        'task_attachment.size_bytes',
        'task_attachment.storage_key',
        'task_attachment.url',
        'task_attachment.unfurl_state',
        'task_attachment.image_storage_key',
        'task_attachment.image_content_type',
        'task_attachment.is_cover',
        'task_attachment.created_at',
      ])
      .where('task.project_id', '=', projectId)
      .orderBy('task_attachment.created_at')
      .orderBy('task_attachment.id')
      .execute(),
  ]);

  const checklistByTask = new Map<string, ProjectExport['tasks'][number]['checklist_items']>();
  for (const item of checklistItems) {
    const items = checklistByTask.get(item.task_id) ?? [];
    items.push({
      id: item.id,
      text: item.text,
      checked: item.checked,
      sort_key: item.sort_key,
    });
    checklistByTask.set(item.task_id, items);
  }

  const attachments: ExportAttachmentRow[] = [];
  const attachmentsByTask = new Map<string, ProjectExport['tasks'][number]['attachments']>();
  for (const row of attachmentRows) {
    const isImage = row.kind === IMAGE_KIND;
    // Both kinds that own bytes archive them the same way. An image's extension
    // comes from its sniffed type, a file's from its name, and neither path is
    // ever built from user-supplied text.
    const storageKey = isImage ? row.image_storage_key : row.storage_key;
    const contentType = isImage ? row.image_content_type : row.content_type;
    const hasBytes = storageKey !== null && row.filename !== null;
    const path = hasBytes
      ? isImage
        ? imageArchivePath(row.id, contentType ?? '')
        : attachmentArchivePath(row.id, row.filename as string)
      : null;
    if (hasBytes) {
      attachments.push({
        id: row.id,
        task_id: row.task_id,
        storage_key: storageKey,
        path: path as string,
        size_bytes: row.size_bytes ?? 0,
      });
    }
    const entries = attachmentsByTask.get(row.task_id) ?? [];
    entries.push({
      id: row.id,
      kind: row.kind === 'link' ? 'link' : isImage ? 'image' : 'file',
      is_cover: row.is_cover,
      path,
      title: row.title,
      description: row.description,
      filename: row.filename,
      content_type: contentType,
      size_bytes: row.size_bytes,
      url: row.url,
      unfurl_state:
        row.unfurl_state === 'pending' || row.unfurl_state === 'ok' || row.unfurl_state === 'failed'
          ? row.unfurl_state
          : null,
      created_at: row.created_at.toISOString(),
    });
    attachmentsByTask.set(row.task_id, entries);
  }

  const exportTask = (
    task: BoardTask,
    archived_at: string | null
  ): ProjectExport['tasks'][number] => ({
    ...task,
    archived_at,
    checklist_items: checklistByTask.get(task.id) ?? [],
    attachments: attachmentsByTask.get(task.id) ?? [],
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

  return { exportPayload, attachments };
}
