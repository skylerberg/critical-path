import { db } from '../../helpers/database';

export interface BoardColumnPayload {
  id: string;
  name: string;
  position: number;
  is_done: boolean;
}

export interface BoardTaskPayload {
  id: string;
  column_id: string;
  title: string;
  description: unknown;
  position: number;
  created_at: string;
  updated_at: string;
  label_ids: string[];
  assignee_ids: string[];
  blocker_ids: string[];
  image_count: number;
}

export interface BoardPayloadBody {
  project: {
    id: string;
    name: string;
    description: string;
    is_template: boolean;
    archived_at: string | null;
    created_at: string;
  };
  columns: BoardColumnPayload[];
  tasks: BoardTaskPayload[];
  labels: Array<{ id: string; name: string; color: string }>;
}

export async function insertTask(options: {
  projectId: string;
  columnId: string;
  title?: string;
  position?: number;
  description?: unknown;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insertInto('task')
    .values({
      id,
      project_id: options.projectId,
      column_id: options.columnId,
      title: options.title ?? 'Test task',
      position: options.position ?? 1000,
      description: options.description === undefined ? null : JSON.stringify(options.description),
    })
    .execute();
  return id;
}

export async function insertLabel(options: {
  projectId: string;
  name: string;
  color?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insertInto('label')
    .values({
      id,
      project_id: options.projectId,
      name: options.name,
      color: options.color ?? '#ff0000',
    })
    .execute();
  return id;
}

export async function insertTaskImage(options: {
  taskId: string;
  imageId?: string;
  storageKey?: string;
  filename?: string;
}): Promise<{ imageId: string; storageKey: string }> {
  const imageId = options.imageId ?? crypto.randomUUID();
  const storageKey = options.storageKey ?? crypto.randomUUID();
  await db
    .insertInto('task_image')
    .values({
      id: imageId,
      task_id: options.taskId,
      storage_key: storageKey,
      filename: options.filename ?? 'test.png',
      content_type: 'image/png',
      size_bytes: 4,
    })
    .execute();
  return { imageId, storageKey };
}

export async function deleteProjects(projectIds: string[]): Promise<void> {
  if (projectIds.length > 0) {
    await db.deleteFrom('project').where('id', 'in', projectIds).execute();
  }
}

export async function waitFor(condition: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) {
      throw new Error('waitFor condition not met within timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
