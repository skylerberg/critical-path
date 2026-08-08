import type { Kysely } from 'kysely';
import type { DB, ResolvedSortKey } from '../db/types';
import { copyTaskAttachments } from './attachments/copy';
import { IMAGE_KIND } from './attachments/index';
import { storage } from './storage/index';
import { BULK_INSERT_CHUNK, MAX_TASKS_PER_PROJECT } from '../config/constants';
import { chunk } from '../utils/arrays';
import { taskCapMessage } from './taskCap';
import { AppError, errorText } from '../utils/errors';
import { logger } from '../utils/logger';
import { dueDateText } from './dateText';
import { appendKeys } from './sortKey';
import { recordTaskActivity } from './taskActivity';
import { copySeries } from './taskSeries/copy';
import { imageIdFromSrc, imageSrc, mapTiptapDoc } from '../schemas/index';
import type { TiptapDoc } from '../schemas/index';

export interface CopyProjectInput {
  id: string;
  name: string;
  description?: string;
  sourceProjectId: string;
  createdBy: string;
}

function rewriteDescriptionImageIds(doc: TiptapDoc, imageIdMap: Map<string, string>): TiptapDoc {
  return mapTiptapDoc(doc, (node) => {
    const src = node.type === 'image' ? node.attrs?.src : undefined;
    const sourceId = typeof src === 'string' ? imageIdFromSrc(src) : null;
    const copyId = sourceId === null ? undefined : imageIdMap.get(sourceId);
    return copyId === undefined
      ? node
      : { ...node, attrs: { ...node.attrs, src: imageSrc(copyId) } };
  });
}

export interface CopyTasksInput {
  sourceTaskIds: string[];
  projectId: string;
  actorUserId: string;
  columnIdFor: (sourceColumnId: string) => string;
  labelIdFor?: (sourceLabelId: string) => string;
  sortKeyFor?: (source: { sort_key: ResolvedSortKey }) => ResolvedSortKey | undefined;
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
  const sortKeyFor = input.sortKeyFor;

  const tasks = await db
    .selectFrom('task')
    .select([
      'task.id',
      'task.column_id',
      'task.title',
      'task.description',
      'task.sort_key',
      dueDateText.as('due_date'),
    ])
    .where('task.id', 'in', input.sourceTaskIds)
    .execute();
  const taskIdMap = new Map(tasks.map((task) => [task.id, newIdFor()]));

  // Only the ids, and only to mint the copies' ids up front: the descriptions
  // inserted below embed `/api/images/<id>` and have to point at the copies
  // before copyTaskAttachments writes them.
  const imageIds = await db
    .selectFrom('task_attachment')
    .select('task_attachment.id')
    .where('task_attachment.task_id', 'in', input.sourceTaskIds)
    .where('task_attachment.kind', '=', IMAGE_KIND)
    .execute();
  const imageIdMap = new Map(imageIds.map((row) => [row.id, crypto.randomUUID()]));

  // A copy into the column it came from cannot keep the source's key -- they
  // are unique per column. Only a copy into a fresh column can, and that is what
  // keeps a duplicated column's cards in the order they were in.
  const destinationKeys = new Map<string, ResolvedSortKey>();
  const appendedBy = new Map<string, string[]>();
  for (const task of tasks) {
    const destination = input.columnIdFor(task.column_id);
    const explicit = sortKeyFor?.(task);
    if (explicit !== undefined) {
      destinationKeys.set(task.id, explicit);
    } else if (destination === task.column_id) {
      const queued = appendedBy.get(destination) ?? [];
      queued.push(task.id);
      appendedBy.set(destination, queued);
    } else {
      destinationKeys.set(task.id, task.sort_key);
    }
  }
  for (const [destination, taskIds] of appendedBy) {
    const fresh = await appendKeys(db, 'task', destination, taskIds.length);
    taskIds.forEach((taskId, index) => destinationKeys.set(taskId, fresh[index]!));
  }

  if (tasks.length > 0) {
    for (const batch of chunk(tasks, BULK_INSERT_CHUNK)) {
      await db
        .insertInto('task')
        .values(
          batch.map((task) => ({
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
            sort_key: destinationKeys.get(task.id) as ResolvedSortKey,
            due_date: task.due_date,
          }))
        )
        .execute();
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

  for (const batch of chunk(taskLabels, BULK_INSERT_CHUNK)) {
    await db
      .insertInto('task_label')
      .values(
        batch.map((row) => ({
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

    for (const batch of chunk(assignees, BULK_INSERT_CHUNK)) {
      await db
        .insertInto('task_assignee')
        .values(
          batch.map((row) => ({
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

  for (const batch of chunk(copyableDependencies, BULK_INSERT_CHUNK)) {
    await db
      .insertInto('task_dependency')
      .values(
        batch.map((row) => ({
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
      'checklist_item.sort_key',
    ])
    .where('checklist_item.task_id', 'in', input.sourceTaskIds)
    .execute();

  for (const batch of chunk(checklistItems, BULK_INSERT_CHUNK)) {
    await db
      .insertInto('checklist_item')
      .values(
        batch.map((row) => ({
          id: crypto.randomUUID(),
          task_id: taskIdMap.get(row.task_id) as string,
          text: row.text,
          checked: row.checked,
          sort_key: row.sort_key,
        }))
      )
      .execute();
  }

  // One routine copies all three kinds now, images included.
  const { objectCopies } = await copyTaskAttachments(db, {
    sourceTaskIds: input.sourceTaskIds,
    taskIdMap,
    imageIdMap,
    insertChunk: BULK_INSERT_CHUNK,
  });

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
            error: errorText(cleanupErr),
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
    .select(['id', 'name', 'sort_key', 'is_done'])
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
          sort_key: column.sort_key,
          is_done: column.is_done,
        }))
      )
      .execute();
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

  // The destination is brand new and holds nothing, so the ceiling applies to
  // what the source will contribute. A source already over it — one that predates
  // the cap — is copyable only by first pruning it, which is the same answer
  // every other creating path gives.
  const sourceTasks = await db
    .selectFrom('task')
    .select('task.id')
    .where('task.project_id', '=', input.sourceProjectId)
    .where('task.archived_at', 'is', null)
    .execute();
  if (sourceTasks.length > MAX_TASKS_PER_PROJECT) {
    throw new AppError(422, taskCapMessage(sourceTasks.length));
  }

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
