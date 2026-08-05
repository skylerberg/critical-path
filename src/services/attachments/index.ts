import type { Kysely, Selectable } from 'kysely';
import type { DB, Project } from '../../db/types';
import { AppError } from '../../utils/errors';
import { assertProjectAccess, assertProjectWrite } from '../authorization';
import type { AttachmentResponse } from '../../schemas/attachments';

export const ATTACHMENT_NOT_FOUND = 'Attachment not found';
export const MAX_ATTACHMENTS_PER_TASK = 50;

export interface AttachmentRow {
  id: string;
  task_id: string;
  kind: string;
  title: string | null;
  description: string | null;
  filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  url: string | null;
  preview_storage_key: string | null;
  favicon_storage_key: string | null;
  unfurl_state: string | null;
  created_at: Date;
  updated_at: Date;
}

const ATTACHMENT_COLUMNS = [
  'task_attachment.id',
  'task_attachment.task_id',
  'task_attachment.kind',
  'task_attachment.title',
  'task_attachment.description',
  'task_attachment.filename',
  'task_attachment.content_type',
  'task_attachment.size_bytes',
  'task_attachment.url',
  'task_attachment.preview_storage_key',
  'task_attachment.favicon_storage_key',
  'task_attachment.unfurl_state',
  'task_attachment.created_at',
  'task_attachment.updated_at',
] as const;

function narrowKind(kind: string): AttachmentResponse['kind'] {
  return kind === 'link' ? 'link' : 'file';
}

function narrowUnfurlState(state: string | null): AttachmentResponse['unfurl_state'] {
  return state === 'pending' || state === 'ok' || state === 'failed' ? state : null;
}

export function toAttachmentResponse(row: AttachmentRow): AttachmentResponse {
  return {
    id: row.id,
    task_id: row.task_id,
    kind: narrowKind(row.kind),
    title: row.title,
    description: row.description,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    url: row.url,
    preview_url: row.preview_storage_key === null ? null : `/api/attachments/${row.id}/preview`,
    favicon_url: row.favicon_storage_key === null ? null : `/api/attachments/${row.id}/favicon`,
    unfurl_state: narrowUnfurlState(row.unfurl_state),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

// Images are rows in this table now, and this is the line between the two things
// the API still presents separately: `attachments[]` and attachment_count mean
// files and links, `images[]` and image_count mean images. Reads on either side
// name this constant rather than spelling the kind, so the release that merges
// the two surfaces can find every decision it has to revisit —
// `grep -rn MIRRORED_IMAGE_KIND src`.
export const MIRRORED_IMAGE_KIND = 'image';

export async function fetchAttachmentRow(
  db: Kysely<DB>,
  attachmentId: string
): Promise<AttachmentRow | undefined> {
  return await db
    .selectFrom('task_attachment')
    .select(ATTACHMENT_COLUMNS)
    .where('task_attachment.id', '=', attachmentId)
    .where('task_attachment.kind', '<>', MIRRORED_IMAGE_KIND)
    .executeTakeFirst();
}

export async function fetchTaskAttachments(
  db: Kysely<DB>,
  taskId: string
): Promise<AttachmentResponse[]> {
  const rows = await db
    .selectFrom('task_attachment')
    .select(ATTACHMENT_COLUMNS)
    .where('task_attachment.task_id', '=', taskId)
    .where('task_attachment.kind', '<>', MIRRORED_IMAGE_KIND)
    .orderBy('task_attachment.created_at')
    .orderBy('task_attachment.id')
    .execute();
  return rows.map(toAttachmentResponse);
}

export async function countTaskAttachments(db: Kysely<DB>, taskId: string): Promise<number> {
  const { count } = await db
    .selectFrom('task_attachment')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('task_attachment.task_id', '=', taskId)
    .where('task_attachment.kind', '<>', MIRRORED_IMAGE_KIND)
    .executeTakeFirstOrThrow();
  return Number(count);
}

async function attachmentProjectId(db: Kysely<DB>, attachmentId: string): Promise<string> {
  const row = await db
    .selectFrom('task_attachment')
    .innerJoin('task', 'task.id', 'task_attachment.task_id')
    .select('task.project_id')
    .where('task_attachment.id', '=', attachmentId)
    .where('task_attachment.kind', '<>', MIRRORED_IMAGE_KIND)
    .executeTakeFirst();
  if (!row) {
    throw new AppError(404, ATTACHMENT_NOT_FOUND);
  }
  return row.project_id;
}

// Attachments are card content rather than discussion, so every mutation
// demands write access: 404 for a caller with none, 403 for a viewer.
export async function assertAttachmentWrite(
  db: Kysely<DB>,
  userId: string,
  attachmentId: string
): Promise<Selectable<Project>> {
  const projectId = await attachmentProjectId(db, attachmentId);
  return await assertProjectWrite(db, userId, projectId, ATTACHMENT_NOT_FOUND);
}

export async function assertAttachmentAccess(
  db: Kysely<DB>,
  userId: string,
  attachmentId: string
): Promise<Selectable<Project>> {
  const projectId = await attachmentProjectId(db, attachmentId);
  return await assertProjectAccess(db, userId, projectId, ATTACHMENT_NOT_FOUND);
}

export type AttachmentScope =
  | { taskIds: string[] }
  | { projectId: string }
  | { projectsCreatedBy: string };

// Every deletion path funnels through here, so none of them can forget one of
// the three key columns a single row may hold.
export async function attachmentStorageKeys(
  db: Kysely<DB>,
  scope: AttachmentScope
): Promise<string[]> {
  if ('taskIds' in scope && scope.taskIds.length === 0) {
    return [];
  }
  let query = db
    .selectFrom('task_attachment')
    .innerJoin('task', 'task.id', 'task_attachment.task_id')
    .select([
      'task_attachment.storage_key',
      'task_attachment.preview_storage_key',
      'task_attachment.favicon_storage_key',
      'task_attachment.image_storage_key',
    ]);

  if ('taskIds' in scope) {
    query = query.where('task_attachment.task_id', 'in', scope.taskIds);
  } else if ('projectId' in scope) {
    query = query.where('task.project_id', '=', scope.projectId);
  } else {
    query = query
      .innerJoin('project', 'project.id', 'task.project_id')
      .where('project.created_by', '=', scope.projectsCreatedBy);
  }

  const rows = await query.execute();
  return rows.flatMap((row) =>
    [
      row.storage_key,
      row.preview_storage_key,
      row.favicon_storage_key,
      row.image_storage_key,
    ].filter((key): key is string => key !== null)
  );
}
