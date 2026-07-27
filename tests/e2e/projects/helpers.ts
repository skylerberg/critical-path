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
  due_date: string | null;
  created_at: string;
  updated_at: string;
  label_ids: string[];
  assignee_ids: string[];
  blocker_ids: string[];
  image_count: number;
  cover_image_url: string | null;
  comment_count: number;
}

export interface BoardPayloadBody {
  project: {
    id: string;
    name: string;
    description: string;
    archived_at: string | null;
    created_at: string;
    is_public: boolean;
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
  dueDate?: string;
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
      due_date: options.dueDate ?? null,
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
  isCover?: boolean;
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
      is_cover: options.isCover ?? false,
    })
    .execute();
  return { imageId, storageKey };
}

export async function insertTaskComment(options: {
  taskId: string;
  userId: string;
  text?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insertInto('task_comment')
    .values({
      id,
      task_id: options.taskId,
      user_id: options.userId,
      body: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: options.text ?? 'hi' }] }],
      }),
    })
    .execute();
  return id;
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
