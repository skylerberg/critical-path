import { db } from '../../helpers/database';
import { newId, uniqueEmail, rankKey } from '../../helpers/fixtures';
import { insertTaskImages } from '../../../src/services/attachments/images';

export class ProjectFixtures {
  private projectIds: string[] = [];
  private ownedUserIds: string[] = [];

  private async fallbackOwner(): Promise<string> {
    const id = newId();
    await db
      .insertInto('app_user')
      .values({
        id,
        email: uniqueEmail('fixture-owner'),
        password_hash: 'x',
        name: 'fixture owner',
      })
      .execute();
    this.ownedUserIds.push(id);
    return id;
  }

  async createProject(
    name = 'tasks e2e project',
    options: { createdBy?: string; memberIds?: string[]; archivedAt?: Date } = {}
  ): Promise<string> {
    const id = newId();
    const createdBy = options.createdBy ?? (await this.fallbackOwner());
    await db
      .insertInto('project')
      .values({ id, name, created_by: createdBy, archived_at: options.archivedAt ?? null })
      .execute();
    const memberIds = (options.memberIds ?? []).filter((userId) => userId !== createdBy);
    if (memberIds.length > 0) {
      await db
        .insertInto('project_member')
        .values(memberIds.map((userId) => ({ project_id: id, user_id: userId })))
        .execute();
    }
    this.projectIds.push(id);
    return id;
  }

  async createColumn(
    projectId: string,
    opts: { name?: string; position?: number; isDone?: boolean } = {}
  ): Promise<string> {
    const id = newId();
    await db
      .insertInto('board_column')
      .values({
        id,
        project_id: projectId,
        name: opts.name ?? 'Column',
        sort_key: rankKey(opts.position ?? 1000),
        is_done: opts.isDone ?? false,
      })
      .execute();
    return id;
  }

  async createLabel(projectId: string, name: string, color = '#ff0000'): Promise<string> {
    const id = newId();
    await db.insertInto('label').values({ id, project_id: projectId, name, color }).execute();
    return id;
  }

  async createTaskRow(
    projectId: string,
    columnId: string,
    title = 'seeded task',
    opts: { description?: unknown; archivedAt?: Date; position?: number; sortKey?: string } = {}
  ): Promise<string> {
    const id = newId();
    await db
      .insertInto('task')
      .values({
        id,
        project_id: projectId,
        column_id: columnId,
        title,
        sort_key: opts.sortKey ?? rankKey(opts.position ?? 1000),
        description: opts.description === undefined ? null : JSON.stringify(opts.description),
        archived_at: opts.archivedAt ?? null,
      })
      .execute();
    return id;
  }

  async createImageRow(
    taskId: string,
    opts: { storageKey?: string; filename?: string } = {}
  ): Promise<string> {
    const id = newId();
    const storageKey = opts.storageKey ?? newId();
    const filename = opts.filename ?? 'picture.png';
    await insertTaskImages(db, [
      {
        id,
        task_id: taskId,
        storage_key: storageKey,
        filename,
        content_type: 'image/png',
        size_bytes: 4,
        is_cover: false,
      },
    ]);
    return id;
  }

  async createDependencyRow(blockerTaskId: string, blockedTaskId: string): Promise<void> {
    await db
      .insertInto('task_dependency')
      .values({ blocker_task_id: blockerTaskId, blocked_task_id: blockedTaskId })
      .execute();
  }

  async cleanup(): Promise<void> {
    if (this.projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', this.projectIds).execute();
    }
    this.projectIds = [];
    if (this.ownedUserIds.length > 0) {
      await db.deleteFrom('app_user').where('id', 'in', this.ownedUserIds).execute();
    }
    this.ownedUserIds = [];
  }
}

export function validDescription(text = 'hello world') {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

export function descriptionWithLink(href: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'a link', marks: [{ type: 'link', attrs: { href } }] }],
      },
    ],
  };
}
