import { db } from '../../helpers/database';
import { insertTaskImages } from '../../../src/services/attachments/images';
import { rankKey } from '../../helpers/fixtures';

export interface BoardColumnPayload {
  id: string;
  name: string;
  sort_key: string;
  is_done: boolean;
}

export interface BoardTaskPayload {
  id: string;
  column_id: string;
  title: string;
  description: unknown;
  sort_key: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  label_ids: string[];
  assignee_ids: string[];
  blocker_ids: string[];
  image_count: number;
  cover_image_url: string | null;
  comment_count: number;
  checklist_item_count: number;
  checklist_done_count: number;
  attachment_count: number;
}

export interface BoardPayloadBody {
  project: {
    id: string;
    name: string;
    description: string;
    archived_at: string | null;
    created_at: string;
    created_by: string | null;
    member_ids: string[];
    members: { user_id: string; role: string }[];
    is_public: boolean;
    color: string | null;
  };
  columns: BoardColumnPayload[];
  tasks: BoardTaskPayload[];
  labels: Array<{ id: string; name: string; color: string }>;
  changed_task_ids: string[];
}

export interface ProjectListItemBody {
  id: string;
  name: string;
  archived_at: string | null;
  position: number | null;
  last_seen_at: string | null;
  has_unseen_changes: boolean;
}

export async function insertTask(options: {
  projectId: string;
  columnId: string;
  title?: string;
  position?: number;
  sort_key?: string;
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
      sort_key: options.sort_key ?? rankKey(options.position ?? 1000),
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
  const filename = options.filename ?? 'test.png';
  const isCover = options.isCover ?? false;
  // Writes both tables through the same mirror the API uses, so a fixture can
  // never describe a state the application could not have produced.
  await insertTaskImages(db, [
    {
      id: imageId,
      task_id: options.taskId,
      storage_key: storageKey,
      filename,
      content_type: 'image/png',
      size_bytes: 4,
      is_cover: isCover,
    },
  ]);
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

// A condition that is already true still returns on the next 25ms tick, so the
// budget only bounds a wait that was going to fail. Ten seconds rather than
// three because these poll socket handshakes and post-commit work on a machine
// that may be running another suite in another worktree.
export async function waitFor(
  condition: () => Promise<boolean>,
  label?: string,
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) {
      throw new Error(
        `waitFor${label === undefined ? '' : ` (${label})`} not met within ${timeoutMs}ms`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
