import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';

export class ProjectFixtures {
  private projectIds: string[] = [];

  async createProject(name = 'tasks e2e project'): Promise<string> {
    const id = newId();
    await db.insertInto('project').values({ id, name }).execute();
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
        position: opts.position ?? 1000,
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

  async createTaskRow(projectId: string, columnId: string, title = 'seeded task'): Promise<string> {
    const id = newId();
    await db
      .insertInto('task')
      .values({ id, project_id: projectId, column_id: columnId, title, position: 1000 })
      .execute();
    return id;
  }

  async createImageRow(
    taskId: string,
    opts: { storageKey?: string; filename?: string } = {}
  ): Promise<string> {
    const id = newId();
    await db
      .insertInto('task_image')
      .values({
        id,
        task_id: taskId,
        storage_key: opts.storageKey ?? newId(),
        filename: opts.filename ?? 'picture.png',
        content_type: 'image/png',
        size_bytes: 4,
      })
      .execute();
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
