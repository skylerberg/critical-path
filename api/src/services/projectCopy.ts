import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { copyTaskAttachments, type ObjectCopy } from './attachments/copy';
import { insertTaskImages } from './attachments/images';
import { MIRRORED_IMAGE_KIND } from './attachments/index';
import { storage } from './storage/index';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { dueDateText } from './dueDate';
import { reconcileSortKeys } from './sortKeyAssignment';
import { recordTaskActivity } from './taskActivity';
import { copySeries } from './taskSeries/copy';
import type { TiptapDoc, TiptapNode } from '../schemas/index';

const IMAGE_SRC_PREFIX = '/api/images/';
const CHECKLIST_INSERT_CHUNK = 5000;

export interface CopyProjectInput {
  id: string;
  name: string;
  description?: string;
  sourceProjectId: string;
  createdBy: string;
}

function rewriteImageSrcs(node: TiptapNode, imageIdMap: Map<string, string>): TiptapNode {
  const next: TiptapNode = { ...node };
  if (next.type === 'image' && next.attrs && typeof next.attrs.src === 'string') {
    const src = next.attrs.src;
    if (src.startsWith(IMAGE_SRC_PREFIX)) {
      const newId = imageIdMap.get(src.slice(IMAGE_SRC_PREFIX.length).toLowerCase());
      if (newId) {
        next.attrs = { ...next.attrs, src: `${IMAGE_SRC_PREFIX}${newId}` };
      }
    }
  }
  if (next.content) {
    next.content = next.content.map((child) => rewriteImageSrcs(child, imageIdMap));
  }
  return next;
}

export function rewriteDescriptionImageIds(
  doc: TiptapDoc,
  imageIdMap: Map<string, string>
): TiptapDoc {
  return rewriteImageSrcs(doc, imageIdMap) as TiptapDoc;
}

export interface CopyTasksInput {
  sourceTaskIds: string[];
  projectId: string;
  actorUserId: string;
  columnIdFor: (sourceColumnId: string) => string;
  labelIdFor?: (sourceLabelId: string) => string;
  positionFor?: (source: { position: number }) => number;
  newIdFor?: () => string;
  copyAssignees: boolean;
}

// Returns source task id -> new task id.
export async function copyTasks(
  db: Kysely<DB>,
  input: CopyTasksInput
): Promise<Map<string, string>> {
  // Every select below filters on `in sourceTaskIds`, which Postgres rejects when empty.
  if (input.sourceTaskIds.length === 0) {
    return new Map();
  }
  const newIdFor = input.newIdFor ?? ((): string => crypto.randomUUID());
  const labelIdFor = input.labelIdFor ?? ((labelId: string): string => labelId);
  const positionFor =
    input.positionFor ?? ((source: { position: number }): number => source.position);

  const tasks = await db
    .selectFrom('task')
    .select([
      'task.id',
      'task.column_id',
      'task.title',
      'task.description',
      'task.position',
      dueDateText.as('due_date'),
    ])
    .where('task.id', 'in', input.sourceTaskIds)
    .execute();
  const taskIdMap = new Map(tasks.map((task) => [task.id, newIdFor()]));

  const imageRows = await db
    .selectFrom('task_attachment')
    .select([
      'task_attachment.id',
      'task_attachment.task_id',
      'task_attachment.image_storage_key',
      'task_attachment.filename',
      'task_attachment.image_content_type',
      'task_attachment.size_bytes',
      'task_attachment.is_cover',
    ])
    .where('task_attachment.task_id', 'in', input.sourceTaskIds)
    .where('task_attachment.kind', '=', MIRRORED_IMAGE_KIND)
    .execute();

  // The image shape CHECK makes these non-null on a kind='image' row.
  const images = imageRows.map((row) => ({
    id: row.id,
    task_id: row.task_id,
    storage_key: row.image_storage_key ?? '',
    filename: row.filename ?? '',
    content_type: row.image_content_type ?? '',
    size_bytes: row.size_bytes ?? 0,
    is_cover: row.is_cover,
  }));
  const imageIdMap = new Map(images.map((image) => [image.id, crypto.randomUUID()]));
  const newStorageKeys = new Map(images.map((image) => [image.id, crypto.randomUUID()]));

  if (tasks.length > 0) {
    await db
      .insertInto('task')
      .values(
        tasks.map((task) => ({
          id: taskIdMap.get(task.id) as string,
          project_id: input.projectId,
          column_id: input.columnIdFor(task.column_id),
          title: task.title,
          description:
            task.description === null
              ? null
              : JSON.stringify(
                  rewriteDescriptionImageIds(task.description as unknown as TiptapDoc, imageIdMap)
                ),
          position: positionFor(task),
          due_date: task.due_date,
        }))
      )
      .execute();

    for (const columnId of new Set(tasks.map((task) => input.columnIdFor(task.column_id)))) {
      await reconcileSortKeys(db, 'task', columnId);
    }

    // The copies are new cards whose history starts here.
    await recordTaskActivity(
      db,
      input.actorUserId,
      tasks.map((task) => ({
        taskId: taskIdMap.get(task.id) as string,
        kind: 'created' as const,
        newValue: { text: task.title },
      }))
    );
  }

  const taskLabels = await db
    .selectFrom('task_label')
    .select(['task_label.task_id', 'task_label.label_id'])
    .where('task_label.task_id', 'in', input.sourceTaskIds)
    .execute();

  if (taskLabels.length > 0) {
    await db
      .insertInto('task_label')
      .values(
        taskLabels.map((row) => ({
          task_id: taskIdMap.get(row.task_id) as string,
          label_id: labelIdFor(row.label_id),
        }))
      )
      .execute();
  }

  if (input.copyAssignees) {
    const assignees = await db
      .selectFrom('task_assignee')
      .select(['task_assignee.task_id', 'task_assignee.user_id'])
      .where('task_assignee.task_id', 'in', input.sourceTaskIds)
      .execute();

    if (assignees.length > 0) {
      await db
        .insertInto('task_assignee')
        .values(
          assignees.map((row) => ({
            task_id: taskIdMap.get(row.task_id) as string,
            user_id: row.user_id,
          }))
        )
        .execute();
    }
  }

  const dependencies = await db
    .selectFrom('task_dependency')
    .select(['task_dependency.blocker_task_id', 'task_dependency.blocked_task_id'])
    .where('task_dependency.blocked_task_id', 'in', input.sourceTaskIds)
    .execute();
  // Both ends have to be inside the copied set, or the copy would inherit an edge
  // to a card nobody duplicated.
  const copyableDependencies = dependencies.filter((row) => taskIdMap.has(row.blocker_task_id));

  if (copyableDependencies.length > 0) {
    await db
      .insertInto('task_dependency')
      .values(
        copyableDependencies.map((row) => ({
          blocker_task_id: taskIdMap.get(row.blocker_task_id) as string,
          blocked_task_id: taskIdMap.get(row.blocked_task_id) as string,
        }))
      )
      .execute();
  }

  const checklistItems = await db
    .selectFrom('checklist_item')
    .select([
      'checklist_item.task_id',
      'checklist_item.text',
      'checklist_item.checked',
      'checklist_item.position',
    ])
    .where('checklist_item.task_id', 'in', input.sourceTaskIds)
    .execute();

  // Chunked because the item count per project is unbounded: Postgres caps a
  // statement at 65,535 bind parameters, and one oversized copy would 500 after
  // the image objects were already written.
  for (let start = 0; start < checklistItems.length; start += CHECKLIST_INSERT_CHUNK) {
    await db
      .insertInto('checklist_item')
      .values(
        checklistItems.slice(start, start + CHECKLIST_INSERT_CHUNK).map((row) => ({
          id: crypto.randomUUID(),
          task_id: taskIdMap.get(row.task_id) as string,
          text: row.text,
          checked: row.checked,
          position: row.position,
        }))
      )
      .execute();
  }

  for (const sourceTaskId of new Set(checklistItems.map((row) => row.task_id))) {
    await reconcileSortKeys(db, 'checklist_item', taskIdMap.get(sourceTaskId) as string);
  }

  await insertTaskImages(
    db,
    images.map((image) => ({
      id: imageIdMap.get(image.id) as string,
      task_id: taskIdMap.get(image.task_id) as string,
      storage_key: newStorageKeys.get(image.id) as string,
      filename: image.filename,
      content_type: image.content_type,
      size_bytes: image.size_bytes,
      is_cover: image.is_cover,
    }))
  );

  const objectCopies: ObjectCopy[] = [
    ...images.map((image) => ({
      source: image.storage_key,
      dest: newStorageKeys.get(image.id) as string,
    })),
    ...(await copyTaskAttachments(db, {
      sourceTaskIds: input.sourceTaskIds,
      taskIdMap,
      insertChunk: CHECKLIST_INSERT_CHUNK,
    })),
  ];

  // Stored objects live outside the transaction, so a partial copy has to be
  // reclaimed by hand or the rollback strands it with no row pointing at it.
  const attemptedKeys: string[] = [];
  try {
    for (const copy of objectCopies) {
      attemptedKeys.push(copy.dest);
      await storage.copy(copy.source, copy.dest);
    }
  } catch (err) {
    await Promise.all(
      attemptedKeys.map((key) =>
        storage.delete(key).catch((cleanupErr: unknown) => {
          logger.error({
            msg: 'Failed to reclaim a copied storage object after a failed copy',
            storageKey: key,
            error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          });
        })
      )
    );
    throw err;
  }

  return taskIdMap;
}

export async function copyProject(db: Kysely<DB>, input: CopyProjectInput): Promise<void> {
  const source = await db
    .selectFrom('project')
    .select(['id', 'description'])
    .where('id', '=', input.sourceProjectId)
    .executeTakeFirst();

  if (!source) {
    throw new AppError(422, 'source_project_id does not reference an existing project');
  }

  await db
    .insertInto('project')
    .values({
      id: input.id,
      name: input.name,
      description: input.description ?? source.description,
      created_by: input.createdBy,
    })
    .execute();

  const columns = await db
    .selectFrom('board_column')
    .select(['id', 'name', 'position', 'is_done'])
    .where('project_id', '=', input.sourceProjectId)
    .execute();
  const columnIdMap = new Map(columns.map((column) => [column.id, crypto.randomUUID()]));

  if (columns.length > 0) {
    await db
      .insertInto('board_column')
      .values(
        columns.map((column) => ({
          id: columnIdMap.get(column.id) as string,
          project_id: input.id,
          name: column.name,
          position: column.position,
          is_done: column.is_done,
        }))
      )
      .execute();

    await reconcileSortKeys(db, 'board_column', input.id);
  }

  const labels = await db
    .selectFrom('label')
    .select(['id', 'name', 'color'])
    .where('project_id', '=', input.sourceProjectId)
    .execute();
  const labelIdMap = new Map(labels.map((label) => [label.id, crypto.randomUUID()]));

  if (labels.length > 0) {
    await db
      .insertInto('label')
      .values(
        labels.map((label) => ({
          id: labelIdMap.get(label.id) as string,
          project_id: input.id,
          name: label.name,
          color: label.color,
        }))
      )
      .execute();
  }

  // Ahead of the tasks: copyTasks writes storage objects the transaction cannot
  // roll back, so nothing that can throw belongs after it.
  await copySeries(db, {
    sourceProjectId: input.sourceProjectId,
    project: { id: input.id, created_by: input.createdBy },
    createdBy: input.createdBy,
    columnIdFor: (columnId) => columnIdMap.get(columnId) as string,
    labelIdFor: (labelId) => labelIdMap.get(labelId) as string,
  });

  const sourceTasks = await db
    .selectFrom('task')
    .select('task.id')
    .where('task.project_id', '=', input.sourceProjectId)
    .where('task.archived_at', 'is', null)
    .execute();

  await copyTasks(db, {
    sourceTaskIds: sourceTasks.map((task) => task.id),
    projectId: input.id,
    actorUserId: input.createdBy,
    columnIdFor: (columnId) => columnIdMap.get(columnId) as string,
    labelIdFor: (labelId) => labelIdMap.get(labelId) as string,
    // A copied project starts personal: it drops its members, so keeping
    // assignees would point every assignment at someone with no access.
    copyAssignees: false,
  });
}
