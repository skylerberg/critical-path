import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { storage } from './storage/index';
import { AppError } from '../utils/errors';
import type { TiptapDoc, TiptapNode } from '../schemas/index';

const IMAGE_SRC_PREFIX = '/api/images/';

export interface CopyProjectInput {
  id: string;
  name: string;
  description?: string;
  isTemplate: boolean;
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
      is_template: input.isTemplate,
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

  const tasks = await db
    .selectFrom('task')
    .select(['id', 'column_id', 'title', 'description', 'position'])
    .where('project_id', '=', input.sourceProjectId)
    .execute();
  const taskIdMap = new Map(tasks.map((task) => [task.id, crypto.randomUUID()]));

  const images = await db
    .selectFrom('task_image')
    .innerJoin('task', 'task.id', 'task_image.task_id')
    .select([
      'task_image.id',
      'task_image.task_id',
      'task_image.storage_key',
      'task_image.filename',
      'task_image.content_type',
      'task_image.size_bytes',
    ])
    .where('task.project_id', '=', input.sourceProjectId)
    .execute();
  const imageIdMap = new Map(images.map((image) => [image.id, crypto.randomUUID()]));
  const newStorageKeys = new Map(images.map((image) => [image.id, crypto.randomUUID()]));

  if (tasks.length > 0) {
    await db
      .insertInto('task')
      .values(
        tasks.map((task) => ({
          id: taskIdMap.get(task.id) as string,
          project_id: input.id,
          column_id: columnIdMap.get(task.column_id) as string,
          title: task.title,
          description:
            task.description === null
              ? null
              : JSON.stringify(
                  rewriteDescriptionImageIds(task.description as unknown as TiptapDoc, imageIdMap)
                ),
          position: task.position,
        }))
      )
      .execute();
  }

  const taskLabels = await db
    .selectFrom('task_label')
    .innerJoin('task', 'task.id', 'task_label.task_id')
    .select(['task_label.task_id', 'task_label.label_id'])
    .where('task.project_id', '=', input.sourceProjectId)
    .execute();

  if (taskLabels.length > 0) {
    await db
      .insertInto('task_label')
      .values(
        taskLabels.map((row) => ({
          task_id: taskIdMap.get(row.task_id) as string,
          label_id: labelIdMap.get(row.label_id) as string,
        }))
      )
      .execute();
  }

  const dependencies = await db
    .selectFrom('task_dependency')
    .innerJoin('task', 'task.id', 'task_dependency.blocked_task_id')
    .select(['task_dependency.blocker_task_id', 'task_dependency.blocked_task_id'])
    .where('task.project_id', '=', input.sourceProjectId)
    .execute();
  // Dependencies are same-project by domain rule; skip any corrupt cross-project row.
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

  if (images.length > 0) {
    await db
      .insertInto('task_image')
      .values(
        images.map((image) => ({
          id: imageIdMap.get(image.id) as string,
          task_id: taskIdMap.get(image.task_id) as string,
          storage_key: newStorageKeys.get(image.id) as string,
          filename: image.filename,
          content_type: image.content_type,
          size_bytes: image.size_bytes,
        }))
      )
      .execute();

    for (const image of images) {
      await storage.copy(image.storage_key, newStorageKeys.get(image.id) as string);
    }
  }
}
