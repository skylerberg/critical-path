import { promises as fs } from 'fs';
import path from 'path';
import { db } from '../../../src/db/index';
import { env } from '../../../src/config/env';
import { newId } from '../../helpers/fixtures';

export function uploadPath(
  taskId: string,
  filename?: string,
  mimeType?: string,
  id?: string
): string {
  const params = new URLSearchParams({ task_id: taskId });
  if (filename) params.set('filename', filename);
  if (mimeType) params.set('content_type', mimeType);
  if (id !== undefined) params.set('id', id);
  return `/api/attachments/files?${params.toString()}`;
}

export function streamOf(chunk: Buffer, times: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= times) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(new Uint8Array(chunk));
    },
  });
}

export interface TaskFixture {
  projectId: string;
  columnId: string;
  taskId: string;
}

export async function createTaskFixture(
  ownerId: string,
  createdProjectIds: string[],
  name = 'attachment test project'
): Promise<TaskFixture> {
  const projectId = newId();
  const columnId = newId();
  const taskId = newId();

  await db.insertInto('project').values({ id: projectId, name, created_by: ownerId }).execute();
  await db
    .insertInto('board_column')
    .values({ id: columnId, project_id: projectId, name: 'To Do', position: 1000 })
    .execute();
  await db
    .insertInto('task')
    .values({
      id: taskId,
      project_id: projectId,
      column_id: columnId,
      title: 'task',
      position: 1000,
    })
    .execute();

  createdProjectIds.push(projectId);
  return { projectId, columnId, taskId };
}

export function storagePath(key: string): string {
  return path.join(env.storageDiskRoot, key);
}

export async function storedKeyExists(key: string): Promise<boolean> {
  try {
    await fs.access(storagePath(key));
    return true;
  } catch {
    return false;
  }
}

export async function listStorageKeys(): Promise<Set<string>> {
  try {
    return new Set(await fs.readdir(env.storageDiskRoot));
  } catch {
    return new Set();
  }
}

// Storage objects outlive the rows, and the rows go away by cascade, so the keys
// have to be collected before the projects are dropped.
export async function cleanupProjects(createdProjectIds: string[]): Promise<void> {
  if (createdProjectIds.length === 0) return;

  const rows = await db
    .selectFrom('task_attachment')
    .innerJoin('task', 'task.id', 'task_attachment.task_id')
    .select([
      'task_attachment.storage_key',
      'task_attachment.preview_storage_key',
      'task_attachment.favicon_storage_key',
    ])
    .where('task.project_id', 'in', createdProjectIds)
    .execute();
  const imageRows = await db
    .selectFrom('task_image')
    .innerJoin('task', 'task.id', 'task_image.task_id')
    .select('task_image.storage_key')
    .where('task.project_id', 'in', createdProjectIds)
    .execute();

  const keys = [
    ...rows.flatMap((row) => [row.storage_key, row.preview_storage_key, row.favicon_storage_key]),
    ...imageRows.map((row) => row.storage_key),
  ].filter((key): key is string => key !== null);

  await Promise.all(keys.map((key) => fs.rm(storagePath(key), { force: true })));
  await db.deleteFrom('project').where('id', 'in', createdProjectIds).execute();
}

// A leftover row of this kind breaks the job runner's exact-contents backlog
// assertions, which run against the same shared database.
export async function clearUnfurlJobs(): Promise<void> {
  await db.deleteFrom('job').where('kind', '=', 'attachment_unfurl').execute();
}
