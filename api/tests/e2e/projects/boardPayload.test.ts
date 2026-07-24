import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import {
  BoardPayloadBody,
  deleteProjects,
  insertLabel,
  insertTask,
  insertTaskImage,
} from './helpers';

describe('GET /api/projects/:id board payload', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let user: TestUser;

  beforeAll(async () => {
    user = await ctx.createUser('board-payload');
  });

  afterAll(async () => {
    await deleteProjects(projectIds);
    await ctx.cleanup();
  });

  it('returns project, columns, tasks with relation ids and image counts, and labels', async () => {
    const projectId = newId();
    projectIds.push(projectId);
    const createRes = await ctx
      .request(user.token)
      .post('/api/projects', { id: projectId, name: 'Payload' });
    expect(createRes.status).toBe(201);
    const board = (await createRes.json()) as BoardPayloadBody;
    const backlog = board.columns.find((c) => c.name === 'Backlog')!;
    const toDo = board.columns.find((c) => c.name === 'To Do')!;

    const usedLabelId = await insertLabel({ projectId, name: 'bug', color: '#aa0000' });
    const unusedLabelId = await insertLabel({ projectId, name: 'idea', color: '#00bb00' });

    const description = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    };
    const blockerTaskId = await insertTask({
      projectId,
      columnId: backlog.id,
      title: 'Blocker',
      position: 1000,
    });
    const mainTaskId = await insertTask({
      projectId,
      columnId: toDo.id,
      title: 'Main',
      position: 2000,
      description,
    });

    await db
      .insertInto('task_label')
      .values({ task_id: mainTaskId, label_id: usedLabelId })
      .execute();
    await db
      .insertInto('task_assignee')
      .values({ task_id: mainTaskId, user_id: user.id })
      .execute();
    await db
      .insertInto('task_dependency')
      .values({ blocker_task_id: blockerTaskId, blocked_task_id: mainTaskId })
      .execute();
    await insertTaskImage({ taskId: mainTaskId });
    await insertTaskImage({ taskId: mainTaskId });

    const res = await ctx.request(user.token).get(`/api/projects/${projectId}`);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as BoardPayloadBody;

    expect(payload.project).toMatchObject({
      id: projectId,
      name: 'Payload',
      archived_at: null,
    });

    expect(payload.columns.map((c) => c.name)).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);

    expect(payload.tasks).toHaveLength(2);
    const mainTask = payload.tasks.find((t) => t.id === mainTaskId)!;
    expect(mainTask).toMatchObject({
      column_id: toDo.id,
      title: 'Main',
      position: 2000,
      label_ids: [usedLabelId],
      assignee_ids: [user.id],
      blocker_ids: [blockerTaskId],
      image_count: 2,
    });
    expect(mainTask.description).toEqual(description);
    expect(typeof mainTask.created_at).toBe('string');
    expect(typeof mainTask.updated_at).toBe('string');

    const blockerTask = payload.tasks.find((t) => t.id === blockerTaskId)!;
    expect(blockerTask).toMatchObject({
      column_id: backlog.id,
      description: null,
      label_ids: [],
      assignee_ids: [],
      blocker_ids: [],
      image_count: 0,
    });

    expect(payload.labels).toEqual([
      { id: usedLabelId, name: 'bug', color: '#aa0000' },
      { id: unusedLabelId, name: 'idea', color: '#00bb00' },
    ]);
  });
});
