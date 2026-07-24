import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { BoardPayloadBody, deleteProjects, insertTask, insertTaskImage } from './helpers';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('project access control', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    alice = await ctx.createUser('authz-alice');
    bob = await ctx.createUser('authz-bob');
  });

  afterAll(async () => {
    await deleteProjects(projectIds);
    await ctx.cleanup();
  });

  async function createProjectAs(user: TestUser, name: string): Promise<BoardPayloadBody> {
    const id = newId();
    projectIds.push(id);
    const res = await ctx.request(user.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    return (await res.json()) as BoardPayloadBody;
  }

  it('stamps created_by on fresh creates and copies', async () => {
    const board = await createProjectAs(alice, 'created-by fresh');
    expect(board.project).toMatchObject({ created_by: alice.id, member_ids: [] });

    const copyId = newId();
    projectIds.push(copyId);
    const copyRes = await ctx.request(alice.token).post('/api/projects', {
      id: copyId,
      name: 'created-by copy',
      source_project_id: board.project.id,
    });
    expect(copyRes.status).toBe(201);
    const copy = (await copyRes.json()) as BoardPayloadBody;
    expect(copy.project).toMatchObject({ created_by: alice.id, member_ids: [] });
  });

  it('copies never inherit the source project members', async () => {
    const board = await createProjectAs(alice, 'copy stays personal');
    const share = await ctx
      .request(alice.token)
      .put(`/api/projects/${board.project.id}/members`, { user_ids: [bob.id] });
    expect(share.status).toBe(204);

    const copyId = newId();
    projectIds.push(copyId);
    const copyRes = await ctx.request(alice.token).post('/api/projects', {
      id: copyId,
      name: 'personal copy',
      source_project_id: board.project.id,
    });
    expect(copyRes.status).toBe(201);
    expect(((await copyRes.json()) as BoardPayloadBody).project.member_ids).toEqual([]);

    const denied = await ctx.request(bob.token).get(`/api/projects/${copyId}`);
    expect(denied.status).toBe(404);
  });

  describe('another user’s personal project', () => {
    let board: BoardPayloadBody;
    let projectId: string;
    let columnId: string;
    let taskId: string;
    let otherTaskId: string;
    let labelId: string;
    let imageId: string;

    beforeAll(async () => {
      board = await createProjectAs(alice, 'alice personal');
      projectId = board.project.id;
      columnId = board.columns[0].id;
      taskId = await insertTask({ projectId, columnId, title: 'alice task' });
      otherTaskId = await insertTask({ projectId, columnId, title: 'alice task 2' });

      const labelRes = await ctx.request(alice.token).post('/api/labels', {
        id: newId(),
        project_id: projectId,
        name: `authz-${newId()}`,
        color: '#112233',
      });
      expect(labelRes.status).toBe(201);
      labelId = ((await labelRes.json()) as { id: string }).id;

      ({ imageId } = await insertTaskImage({ taskId }));
    });

    it('returns 404 on every project-scoped route for a non-creator', async () => {
      const b = ctx.request(bob.token);
      const form = new FormData();
      form.append('file', new File([new Uint8Array(PNG_1X1)], 'p.png', { type: 'image/png' }));

      const attempts: Array<Promise<Response>> = [
        b.get(`/api/projects/${projectId}`),
        b.patch(`/api/projects/${projectId}`, { name: 'stolen' }),
        b.delete(`/api/projects/${projectId}`),
        b.post('/api/projects', {
          id: newId(),
          name: 'exfiltrated',
          source_project_id: projectId,
        }),
        b.post('/api/columns', {
          id: newId(),
          project_id: projectId,
          name: 'intruder',
          position: 9000,
        }),
        b.patch(`/api/columns/${columnId}`, { name: 'renamed' }),
        b.delete(`/api/columns/${columnId}`),
        b.post('/api/tasks', {
          id: newId(),
          project_id: projectId,
          column_id: columnId,
          title: 'intruder task',
          position: 1000,
        }),
        b.get(`/api/tasks/${taskId}`),
        b.patch(`/api/tasks/${taskId}`, { title: 'stolen task' }),
        b.delete(`/api/tasks/${taskId}`),
        b.put(`/api/tasks/${taskId}/labels`, { label_ids: [] }),
        b.put(`/api/tasks/${taskId}/assignees`, { user_ids: [] }),
        b.post(`/api/tasks/${taskId}/blockers`, { blocker_task_id: otherTaskId }),
        b.delete(`/api/tasks/${taskId}/blockers/${otherTaskId}`),
        b.post('/api/labels', {
          id: newId(),
          project_id: projectId,
          name: 'intruder label',
          color: '#000000',
        }),
        b.patch(`/api/labels/${labelId}`, { name: 'stolen label' }),
        b.delete(`/api/labels/${labelId}`),
        b.postMultipart(`/api/tasks/${taskId}/images`, form),
        b.delete(`/api/images/${imageId}`),
      ];

      for (const res of await Promise.all(attempts)) {
        expect(res.status).toBe(404);
      }

      const stillThere = await ctx.request(alice.token).get(`/api/projects/${projectId}`);
      expect(stillThere.status).toBe(200);
    });

    it('excludes it from the other user’s project list but keeps it in the creator’s', async () => {
      const aliceList = await ctx.request(alice.token).get('/api/projects');
      const aliceBody = await aliceList.json();
      expect(aliceBody.projects.some((p: { id: string }) => p.id === projectId)).toBe(true);

      const bobList = await ctx.request(bob.token).get('/api/projects');
      const bobBody = await bobList.json();
      expect(bobBody.projects.some((p: { id: string }) => p.id === projectId)).toBe(false);
    });
  });

  describe('membership sharing lifecycle', () => {
    it('grants access when added as a member and revokes it on removal', async () => {
      const board = await createProjectAs(alice, 'alice shared');
      const projectId = board.project.id;

      const beforeAdd = await ctx.request(bob.token).get(`/api/projects/${projectId}`);
      expect(beforeAdd.status).toBe(404);

      const add = await ctx
        .request(alice.token)
        .post(`/api/projects/${projectId}/members/by-email`, { email: bob.email });
      expect(add.status).toBe(200);

      const afterAdd = await ctx.request(bob.token).get(`/api/projects/${projectId}`);
      expect(afterAdd.status).toBe(200);

      const bobList = await ctx.request(bob.token).get('/api/projects');
      expect((await bobList.json()).projects.some((p: { id: string }) => p.id === projectId)).toBe(
        true
      );

      const rename = await ctx
        .request(bob.token)
        .patch(`/api/projects/${projectId}`, { name: 'renamed by bob' });
      expect(rename.status).toBe(200);

      const remove = await ctx.request(alice.token).put(`/api/projects/${projectId}/members`, {
        user_ids: [],
      });
      expect(remove.status).toBe(204);

      const afterRemove = await ctx.request(bob.token).get(`/api/projects/${projectId}`);
      expect(afterRemove.status).toBe(404);
    });

    it('strips assignees who lose access when their membership is removed', async () => {
      const board = await createProjectAs(alice, 'alice strip on removal');
      const projectId = board.project.id;
      await ctx
        .request(alice.token)
        .post(`/api/projects/${projectId}/members/by-email`, { email: bob.email });

      const taskId = await insertTask({ projectId, columnId: board.columns[0].id });
      const assign = await ctx.request(alice.token).put(`/api/tasks/${taskId}/assignees`, {
        user_ids: [alice.id, bob.id],
      });
      expect(assign.status).toBe(204);

      const toPersonal = await ctx
        .request(alice.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [] });
      expect(toPersonal.status).toBe(204);

      const assignees = await db
        .selectFrom('task_assignee')
        .select('user_id')
        .where('task_id', '=', taskId)
        .execute();
      expect(assignees.map((r) => r.user_id)).toEqual([alice.id]);
    });
  });

  describe('assignee access validation', () => {
    it('rejects newly added assignees without project access, on create and on set', async () => {
      const board = await createProjectAs(alice, 'assignee validation');
      const projectId = board.project.id;
      const columnId = board.columns[0].id;

      const createRes = await ctx.request(alice.token).post('/api/tasks', {
        id: newId(),
        project_id: projectId,
        column_id: columnId,
        title: 'with intruder assignee',
        position: 1000,
        assignee_ids: [bob.id],
      });
      expect(createRes.status).toBe(422);

      const taskId = await insertTask({ projectId, columnId });
      const setRes = await ctx.request(alice.token).put(`/api/tasks/${taskId}/assignees`, {
        user_ids: [alice.id, bob.id],
      });
      expect(setRes.status).toBe(422);
    });

    it('never re-validates assignees that are already present', async () => {
      const board = await createProjectAs(alice, 'assignee echo');
      const projectId = board.project.id;
      const taskId = await insertTask({ projectId, columnId: board.columns[0].id });

      await db.insertInto('task_assignee').values({ task_id: taskId, user_id: bob.id }).execute();

      const echo = await ctx.request(alice.token).put(`/api/tasks/${taskId}/assignees`, {
        user_ids: [bob.id, alice.id],
      });
      expect(echo.status).toBe(204);

      const rows = await db
        .selectFrom('task_assignee')
        .select('user_id')
        .where('task_id', '=', taskId)
        .execute();
      expect(rows.map((r) => r.user_id).sort()).toEqual([alice.id, bob.id].sort());

      const dropAndReadd = await ctx.request(alice.token).put(`/api/tasks/${taskId}/assignees`, {
        user_ids: [alice.id],
      });
      expect(dropAndReadd.status).toBe(204);

      const readd = await ctx.request(alice.token).put(`/api/tasks/${taskId}/assignees`, {
        user_ids: [alice.id, bob.id],
      });
      expect(readd.status).toBe(422);
    });
  });
});
