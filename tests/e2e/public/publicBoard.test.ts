import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import {
  BoardColumnPayload,
  BoardPayloadBody,
  deleteProjects,
  insertLabel,
  insertTask,
} from '../projects/helpers';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function imageForm(): FormData {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(PNG_1X1)], 'pixel.png', { type: 'image/png' }));
  return form;
}

interface PublicBoardBody {
  project: { id: string; name: string; description: string };
  columns: BoardColumnPayload[];
  tasks: Array<{
    id: string;
    column_id: string;
    title: string;
    description: unknown;
    position: number;
    due_date: string | null;
    label_ids: string[];
    assignee_ids: string[];
    blocker_ids: string[];
    image_count: number;
    cover_image_url: string | null;
  }>;
  labels: Array<{ id: string; name: string; color: string }>;
  users: Array<{ id: string; name: string; avatar_url: string | null }>;
}

describe('GET /api/public/projects/:id/board', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let owner: TestUser;
  let assignee: TestUser;
  let idleMember: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    owner = await ctx.createUser('public-board-owner');
    assignee = await ctx.createUser('public-board-assignee');
    idleMember = await ctx.createUser('public-board-idle');
    outsider = await ctx.createUser('public-board-outsider');
  });

  afterAll(async () => {
    await deleteProjects(projectIds);
    await ctx.cleanup();
  });

  async function createProject(name: string): Promise<BoardPayloadBody> {
    const projectId = newId();
    projectIds.push(projectId);
    const res = await ctx.request(owner.token).post('/api/projects', { id: projectId, name });
    expect(res.status).toBe(201);
    return (await res.json()) as BoardPayloadBody;
  }

  async function publish(projectId: string, isPublic: boolean): Promise<Response> {
    return ctx.request(owner.token).patch(`/api/projects/${projectId}`, { is_public: isPublic });
  }

  async function seedBoard(board: BoardPayloadBody): Promise<{
    imageId: string;
    labelId: string;
    unusedLabelId: string;
    blockerTaskId: string;
    mainTaskId: string;
  }> {
    const projectId = board.project.id;
    const backlog = board.columns.find((column) => column.name === 'Backlog')!;
    const done = board.columns.find((column) => column.name === 'Done')!;

    const membersRes = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [assignee.id, idleMember.id] });
    expect(membersRes.status).toBe(204);

    const labelId = await insertLabel({ projectId, name: 'bug', color: '#aa0000' });
    const unusedLabelId = await insertLabel({ projectId, name: 'idea', color: '#00bb00' });

    const blockerTaskId = await insertTask({
      projectId,
      columnId: done.id,
      title: 'Blocker',
      position: 1000,
    });
    const uploadRes = await ctx
      .request(owner.token)
      .postMultipart(`/api/tasks/${blockerTaskId}/images`, imageForm());
    expect(uploadRes.status).toBe(201);
    const { id: imageId } = (await uploadRes.json()) as { id: string };
    const coverRes = await ctx
      .request(owner.token)
      .put(`/api/tasks/${blockerTaskId}/cover`, { image_id: imageId });
    expect(coverRes.status).toBe(204);

    const mainTaskId = await insertTask({
      projectId,
      columnId: backlog.id,
      title: 'Main',
      position: 2000,
      dueDate: '2026-08-03',
      description: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Ship the roadmap' }] },
          { type: 'image', attrs: { src: `/api/images/${imageId}`, alt: null, title: null } },
        ],
      },
    });

    await db.insertInto('task_label').values({ task_id: mainTaskId, label_id: labelId }).execute();
    await db
      .insertInto('task_assignee')
      .values({ task_id: mainTaskId, user_id: assignee.id })
      .execute();
    await db
      .insertInto('task_dependency')
      .values({ blocker_task_id: blockerTaskId, blocked_task_id: mainTaskId })
      .execute();

    return { imageId, labelId, unusedLabelId, blockerTaskId, mainTaskId };
  }

  it('defaults to private and 404s the public board', async () => {
    const board = await createProject('Private by default');
    expect(board.project).toMatchObject({ is_public: false });

    const getRes = await ctx.request(owner.token).get(`/api/projects/${board.project.id}`);
    expect(((await getRes.json()) as BoardPayloadBody).project).toMatchObject({
      is_public: false,
    });

    const listRes = await ctx.request(owner.token).get('/api/projects');
    const list = (await listRes.json()) as { projects: Array<{ id: string; is_public: boolean }> };
    expect(list.projects.find((p) => p.id === board.project.id)).toMatchObject({
      is_public: false,
    });

    const publicRes = await ctx.request().get(`/api/public/projects/${board.project.id}/board`);
    expect(publicRes.status).toBe(404);
    expect(await publicRes.json()).toEqual({ error: 'This board is not public' });
  });

  it('serves the board to an anonymous caller once published, and stops on unpublish', async () => {
    const board = await createProject('Roadmap');
    const projectId = board.project.id;
    const seeded = await seedBoard(board);

    const patchRes = await publish(projectId, true);
    expect(patchRes.status).toBe(200);
    expect(await patchRes.json()).toMatchObject({ id: projectId, is_public: true });

    const res = await ctx.request().get(`/api/public/projects/${projectId}/board`);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as PublicBoardBody;

    expect(payload.project).toEqual({
      id: projectId,
      name: 'Roadmap',
      description: '',
    });
    expect(payload.tasks.map((task) => task.id)).toEqual([seeded.blockerTaskId, seeded.mainTaskId]);
    const main = payload.tasks.find((task) => task.id === seeded.mainTaskId)!;
    expect(main).toMatchObject({
      title: 'Main',
      label_ids: [seeded.labelId],
      assignee_ids: [assignee.id],
      blocker_ids: [seeded.blockerTaskId],
      image_count: 0,
      cover_image_url: null,
    });
    const blocker = payload.tasks.find((task) => task.id === seeded.blockerTaskId)!;
    expect(blocker.cover_image_url).toBe(`/api/images/${seeded.imageId}`);
    expect(payload.labels.map((label) => label.id).sort()).toEqual(
      [seeded.labelId, seeded.unusedLabelId].sort()
    );

    const unpublishRes = await publish(projectId, false);
    expect(unpublishRes.status).toBe(200);
    expect(await unpublishRes.json()).toMatchObject({ is_public: false });

    const afterRes = await ctx.request().get(`/api/public/projects/${projectId}/board`);
    expect(afterRes.status).toBe(404);
    expect(await afterRes.json()).toEqual({ error: 'This board is not public' });
  });

  it('reuses the authenticated board payload for columns, labels, and task ordering', async () => {
    const board = await createProject('Reuse');
    const projectId = board.project.id;
    await seedBoard(board);
    expect((await publish(projectId, true)).status).toBe(200);

    const privateRes = await ctx.request(owner.token).get(`/api/projects/${projectId}`);
    const privatePayload = (await privateRes.json()) as BoardPayloadBody;
    const publicRes = await ctx.request().get(`/api/public/projects/${projectId}/board`);
    const publicPayload = (await publicRes.json()) as PublicBoardBody;

    expect(publicPayload.columns).toEqual(privatePayload.columns);
    expect(publicPayload.labels).toEqual(privatePayload.labels);
    expect(publicPayload.tasks).toEqual(
      privatePayload.tasks.map((task) => ({
        id: task.id,
        column_id: task.column_id,
        title: task.title,
        description: task.description,
        position: task.position,
        due_date: task.due_date,
        label_ids: task.label_ids,
        assignee_ids: task.assignee_ids,
        blocker_ids: task.blocker_ids,
        image_count: task.image_count,
        cover_image_url: task.cover_image_url,
      }))
    );
  });

  it('never serves an archived task, nor names one as a blocker', async () => {
    const board = await createProject('Archived');
    const projectId = board.project.id;
    const { blockerTaskId, mainTaskId } = await seedBoard(board);
    expect((await publish(projectId, true)).status).toBe(200);

    expect(
      (await ctx.request(owner.token).post(`/api/tasks/${blockerTaskId}/archive`)).status
    ).toBe(200);

    const res = await ctx.request().get(`/api/public/projects/${projectId}/board`);
    const payload = (await res.json()) as PublicBoardBody;
    expect(payload.tasks.map((task) => task.id)).not.toContain(blockerTaskId);
    expect(payload.tasks.find((task) => task.id === mainTaskId)?.blocker_ids).toEqual([]);
  });

  it('drops identity fields and exposes only assigned users, without emails', async () => {
    const board = await createProject('Shaping');
    const projectId = board.project.id;
    await seedBoard(board);
    expect((await publish(projectId, true)).status).toBe(200);

    const res = await ctx.request().get(`/api/public/projects/${projectId}/board`);
    const payload = (await res.json()) as PublicBoardBody;

    expect(Object.keys(payload).sort()).toEqual(['columns', 'labels', 'project', 'tasks', 'users']);
    expect(Object.keys(payload.project).sort()).toEqual(['description', 'id', 'name']);
    for (const task of payload.tasks) {
      expect(Object.keys(task).sort()).toEqual([
        'assignee_ids',
        'blocker_ids',
        'column_id',
        'cover_image_url',
        'description',
        'due_date',
        'id',
        'image_count',
        'label_ids',
        'position',
        'title',
      ]);
    }

    expect(payload.users).toEqual([{ id: assignee.id, name: assignee.name, avatar_url: null }]);
    expect(JSON.stringify(payload)).not.toContain(assignee.email);
    expect(JSON.stringify(payload)).not.toContain(owner.email);
    expect(payload.users.map((user) => user.id)).not.toContain(idleMember.id);
    expect(payload.users.map((user) => user.id)).not.toContain(owner.id);
  });

  it('never serves a task’s activity log to an anonymous reader', async () => {
    const board = await createProject('History stays private');
    const projectId = board.project.id;
    const { mainTaskId } = await seedBoard(board);
    expect((await publish(projectId, true)).status).toBe(200);

    const payload = (await (
      await ctx.request().get(`/api/public/projects/${projectId}/board`)
    ).json()) as PublicBoardBody;
    expect(JSON.stringify(payload)).not.toContain('activity');

    expect((await ctx.request().get(`/api/tasks/${mainTaskId}/activity`)).status).toBe(401);
    expect(
      (await ctx.request(outsider.token).get(`/api/tasks/${mainTaskId}/activity`)).status
    ).toBe(404);
  });

  it('keeps descriptions and their embedded images readable without a token', async () => {
    const board = await createProject('Descriptions');
    const projectId = board.project.id;
    const seeded = await seedBoard(board);
    expect((await publish(projectId, true)).status).toBe(200);

    const res = await ctx.request().get(`/api/public/projects/${projectId}/board`);
    const payload = (await res.json()) as PublicBoardBody;
    const main = payload.tasks.find((task) => task.id === seeded.mainTaskId)!;
    expect(main.description).toMatchObject({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Ship the roadmap' }] },
        { type: 'image', attrs: { src: `/api/images/${seeded.imageId}` } },
      ],
    });

    const imageRes = await ctx.request().get(`/api/images/${seeded.imageId}`);
    expect(imageRes.status).toBe(200);
    expect(imageRes.headers.get('Content-Type')).toBe('image/png');
  });

  it('sets a noindex robots header and never caches the response', async () => {
    const board = await createProject('Headers');
    const projectId = board.project.id;
    expect((await publish(projectId, true)).status).toBe(200);

    const res = await ctx.request().get(`/api/public/projects/${projectId}/board`);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('400s a malformed id and 404s an unknown one', async () => {
    const unknownRes = await ctx.request().get(`/api/public/projects/${newId()}/board`);
    expect(unknownRes.status).toBe(404);

    const malformedRes = await ctx.request().get('/api/public/projects/not-a-uuid/board');
    expect(malformedRes.status).toBe(400);
  });

  it('keeps every mutating and authenticated route closed while published', async () => {
    const board = await createProject('Read only');
    const projectId = board.project.id;
    const column = board.columns[0];
    expect((await publish(projectId, true)).status).toBe(200);

    const anon = ctx.request();
    expect(
      (
        await anon.post('/api/tasks', {
          id: newId(),
          project_id: projectId,
          column_id: column.id,
          title: 'Injected',
        })
      ).status
    ).toBe(401);
    expect((await anon.patch(`/api/projects/${projectId}`, { name: 'Renamed' })).status).toBe(401);
    expect((await anon.delete(`/api/projects/${projectId}`)).status).toBe(401);
    expect((await anon.get(`/api/projects/${projectId}`)).status).toBe(401);

    const outsiderRes = await ctx.request(outsider.token).get(`/api/projects/${projectId}`);
    expect(outsiderRes.status).toBe(404);
  });

  it('404s an outsider trying to publish someone else’s project', async () => {
    const board = await createProject('Not yours');
    const res = await ctx
      .request(outsider.token)
      .patch(`/api/projects/${board.project.id}`, { is_public: true });
    expect(res.status).toBe(404);

    const publicRes = await ctx.request().get(`/api/public/projects/${board.project.id}/board`);
    expect(publicRes.status).toBe(404);
  });

  it('lets a plain member publish and un-publish, not only the creator', async () => {
    const board = await createProject('Member publishes');
    const projectId = board.project.id;
    const membersRes = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [assignee.id] });
    expect(membersRes.status).toBe(204);

    const publishRes = await ctx
      .request(assignee.token)
      .patch(`/api/projects/${projectId}`, { is_public: true });
    expect(publishRes.status).toBe(200);
    expect(await publishRes.json()).toMatchObject({ is_public: true });
    expect((await ctx.request().get(`/api/public/projects/${projectId}/board`)).status).toBe(200);

    const unpublishRes = await ctx
      .request(assignee.token)
      .patch(`/api/projects/${projectId}`, { is_public: false });
    expect(unpublishRes.status).toBe(200);
    expect((await ctx.request().get(`/api/public/projects/${projectId}/board`)).status).toBe(404);
  });

  it('keeps two published boards separate', async () => {
    const first = await createProject('First');
    const second = await createProject('Second');
    const firstTaskId = await insertTask({
      projectId: first.project.id,
      columnId: first.columns[0].id,
      title: 'First task',
    });
    const secondTaskId = await insertTask({
      projectId: second.project.id,
      columnId: second.columns[0].id,
      title: 'Second task',
    });
    expect((await publish(first.project.id, true)).status).toBe(200);
    expect((await publish(second.project.id, true)).status).toBe(200);

    const firstPayload = (await (
      await ctx.request().get(`/api/public/projects/${first.project.id}/board`)
    ).json()) as PublicBoardBody;
    const secondPayload = (await (
      await ctx.request().get(`/api/public/projects/${second.project.id}/board`)
    ).json()) as PublicBoardBody;

    expect(firstPayload.tasks.map((task) => task.id)).toEqual([firstTaskId]);
    expect(secondPayload.tasks.map((task) => task.id)).toEqual([secondTaskId]);
  });
});
