import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import {
  BoardPayloadBody,
  ProjectListItemBody,
  deleteProjects,
  insertTask,
  insertTaskComment,
} from './helpers';

describe('What changed since you last looked', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    owner = await ctx.createUser('seen-owner');
    editor = await ctx.createUser('seen-editor');
    viewer = await ctx.createUser('seen-viewer');
    stranger = await ctx.createUser('seen-stranger');
  });

  afterAll(async () => {
    await deleteProjects(projectIds);
    await ctx.cleanup();
  });

  async function createProject(as: TestUser, name = 'seen'): Promise<BoardPayloadBody> {
    const id = newId();
    projectIds.push(id);
    const res = await ctx.request(as.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    return (await res.json()) as BoardPayloadBody;
  }

  async function share(projectId: string, as: TestUser, members: TestUser[]): Promise<void> {
    const res = await ctx.request(as.token).put(`/api/projects/${projectId}/members`, {
      user_ids: members.map((member) => member.id),
      roles: members.map((member) => ({
        user_id: member.id,
        role: member === viewer ? 'viewer' : 'editor',
      })),
    });
    expect(res.status).toBe(204);
  }

  async function listItem(as: TestUser, projectId: string): Promise<ProjectListItemBody> {
    const res = await ctx.request(as.token).get('/api/projects');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: ProjectListItemBody[] };
    return body.projects.find((project) => project.id === projectId)!;
  }

  async function board(as: TestUser, projectId: string): Promise<BoardPayloadBody> {
    const res = await ctx.request(as.token).get(`/api/projects/${projectId}`);
    expect(res.status).toBe(200);
    return (await res.json()) as BoardPayloadBody;
  }

  async function stamp(as: TestUser, projectId: string): Promise<number> {
    const res = await ctx.request(as.token).put(`/api/projects/${projectId}/seen`, {});
    return res.status;
  }

  it('reports nothing unseen to a member who has never opened the board', async () => {
    const created = await createProject(owner);
    await share(created.project.id, owner, [editor]);
    const taskId = await insertTask({
      projectId: created.project.id,
      columnId: created.columns[0]!.id,
    });
    const patched = await ctx
      .request(owner.token)
      .patch(`/api/tasks/${taskId}`, { title: 'Owner touched this' });
    expect(patched.status).toBe(200);

    const item = await listItem(editor, created.project.id);
    expect(item.last_seen_at).toBeNull();
    expect(item.has_unseen_changes).toBe(false);
    expect((await board(editor, created.project.id)).changed_task_ids).toEqual([]);
  });

  it("names the tasks somebody else touched after the caller's marker, and no others", async () => {
    const created = await createProject(owner);
    await share(created.project.id, owner, [editor]);
    const columnId = created.columns[0]!.id;
    const untouched = await insertTask({ projectId: created.project.id, columnId });
    const changed = await insertTask({ projectId: created.project.id, columnId });
    const commented = await insertTask({ projectId: created.project.id, columnId });
    const mine = await insertTask({ projectId: created.project.id, columnId });

    expect(await stamp(editor, created.project.id)).toBe(204);

    for (const [as, taskId] of [
      [owner, changed],
      [editor, mine],
    ] as const) {
      const res = await ctx.request(as.token).patch(`/api/tasks/${taskId}`, { title: 'after' });
      expect(res.status).toBe(200);
    }
    await insertTaskComment({ taskId: commented, userId: owner.id });

    const item = await listItem(editor, created.project.id);
    expect(item.last_seen_at).not.toBeNull();
    expect(item.has_unseen_changes).toBe(true);

    const first = await board(editor, created.project.id);
    expect(first.tasks.map((task) => task.id).sort()).toEqual(
      [untouched, changed, commented, mine].sort()
    );
    expect(first.changed_task_ids).toEqual([changed, commented].sort());

    // Only PUT /:id/seen stamps: a second board read, and an export taken
    // between the two, have to leave both the marker and the highlights exactly
    // where they were.
    const exported = await ctx
      .request(editor.token)
      .get(`/api/projects/${created.project.id}/export?format=json`);
    expect(exported.status).toBe(200);
    expect((await board(editor, created.project.id)).changed_task_ids).toEqual(
      [changed, commented].sort()
    );
    const unmoved = await listItem(editor, created.project.id);
    expect(unmoved.last_seen_at).toBe(item.last_seen_at);
    expect(unmoved.has_unseen_changes).toBe(true);

    expect(await stamp(editor, created.project.id)).toBe(204);
    expect((await listItem(editor, created.project.id)).has_unseen_changes).toBe(false);
    expect((await board(editor, created.project.id)).changed_task_ids).toEqual([]);
    expect((await listItem(owner, created.project.id)).has_unseen_changes).toBe(false);
  });

  it('holds one marker per member, so one of them opening the board clears nobody else', async () => {
    const created = await createProject(owner);
    await share(created.project.id, owner, [editor]);
    const columnId = created.columns[0]!.id;
    const forEditor = await insertTask({ projectId: created.project.id, columnId });
    const forOwner = await insertTask({ projectId: created.project.id, columnId });

    expect(await stamp(editor, created.project.id)).toBe(204);
    const byOwner = await ctx
      .request(owner.token)
      .patch(`/api/tasks/${forEditor}`, { title: 'owner touched this' });
    expect(byOwner.status).toBe(200);
    expect(await stamp(owner, created.project.id)).toBe(204);
    const byEditor = await ctx
      .request(editor.token)
      .patch(`/api/tasks/${forOwner}`, { title: 'editor touched this' });
    expect(byEditor.status).toBe(200);

    expect((await listItem(editor, created.project.id)).has_unseen_changes).toBe(true);
    expect((await board(editor, created.project.id)).changed_task_ids).toEqual([forEditor]);
    expect((await listItem(owner, created.project.id)).has_unseen_changes).toBe(true);
    expect((await board(owner, created.project.id)).changed_task_ids).toEqual([forOwner]);
  });

  it('answers false for an archived project but keeps highlighting inside it', async () => {
    const created = await createProject(owner);
    await share(created.project.id, owner, [editor]);
    const taskId = await insertTask({
      projectId: created.project.id,
      columnId: created.columns[0]!.id,
    });
    expect(await stamp(editor, created.project.id)).toBe(204);
    const patched = await ctx
      .request(owner.token)
      .patch(`/api/tasks/${taskId}`, { title: 'moved' });
    expect(patched.status).toBe(200);
    expect((await listItem(editor, created.project.id)).has_unseen_changes).toBe(true);

    const archived = await ctx
      .request(owner.token)
      .patch(`/api/projects/${created.project.id}`, { archived_at: new Date().toISOString() });
    expect(archived.status).toBe(200);

    expect((await listItem(editor, created.project.id)).has_unseen_changes).toBe(false);
    expect((await board(editor, created.project.id)).changed_task_ids).toEqual([taskId]);
    expect(await stamp(editor, created.project.id)).toBe(204);
    expect((await board(editor, created.project.id)).changed_task_ids).toEqual([]);
  });

  it('notices nothing about a card that was archived or deleted', async () => {
    const created = await createProject(owner);
    await share(created.project.id, owner, [editor]);
    const columnId = created.columns[0]!.id;
    const archivedTask = await insertTask({ projectId: created.project.id, columnId });
    const deletedTask = await insertTask({ projectId: created.project.id, columnId });
    expect(await stamp(editor, created.project.id)).toBe(204);

    const archiveRes = await ctx.request(owner.token).post(`/api/tasks/${archivedTask}/archive`);
    expect(archiveRes.status).toBe(200);
    await ctx.request(owner.token).post(`/api/tasks/${deletedTask}/archive`);
    const deleteRes = await ctx.request(owner.token).delete(`/api/tasks/${deletedTask}`);
    expect(deleteRes.status).toBe(204);

    expect((await listItem(editor, created.project.id)).has_unseen_changes).toBe(false);
    expect((await board(editor, created.project.id)).changed_task_ids).toEqual([]);
  });

  it('gives a viewer the same marker, the same dot and the same highlights', async () => {
    const created = await createProject(owner);
    await share(created.project.id, owner, [viewer]);
    const taskId = await insertTask({
      projectId: created.project.id,
      columnId: created.columns[0]!.id,
    });

    expect(await stamp(viewer, created.project.id)).toBe(204);
    const patched = await ctx
      .request(owner.token)
      .patch(`/api/tasks/${taskId}`, { title: 'after' });
    expect(patched.status).toBe(200);

    expect((await listItem(viewer, created.project.id)).has_unseen_changes).toBe(true);
    expect((await board(viewer, created.project.id)).changed_task_ids).toEqual([taskId]);
  });

  it('answers 404 to a caller with no access and never 403', async () => {
    const created = await createProject(owner);
    expect(await stamp(stranger, created.project.id)).toBe(404);
    expect(await stamp(stranger, newId())).toBe(404);

    const rows = await db
      .selectFrom('project_user_seen')
      .select('project_user_seen.user_id')
      .where('project_user_seen.project_id', '=', created.project.id)
      .execute();
    expect(rows).toEqual([]);
  });

  it('drops a removed member’s marker so re-adding them does not restore it', async () => {
    const created = await createProject(owner);
    await share(created.project.id, owner, [editor]);
    expect(await stamp(editor, created.project.id)).toBe(204);

    const removed = await ctx
      .request(owner.token)
      .put(`/api/projects/${created.project.id}/members`, { user_ids: [] });
    expect(removed.status).toBe(204);

    const rows = await db
      .selectFrom('project_user_seen')
      .select('project_user_seen.user_id')
      .where('project_user_seen.project_id', '=', created.project.id)
      .execute();
    expect(rows).toEqual([]);

    await share(created.project.id, owner, [editor]);
    expect((await listItem(editor, created.project.id)).last_seen_at).toBeNull();
  });

  it('returns an empty changed_task_ids from a freshly created project', async () => {
    const created = await createProject(owner);
    expect(created.changed_task_ids).toEqual([]);
  });

  it('stamps while a member write holds the project row for update', async () => {
    const created = await createProject(owner);
    await share(created.project.id, owner, [editor]);
    expect(await stamp(editor, created.project.id)).toBe(204);

    let held!: () => void;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });

    // What setting the member list does: hold the project row, then delete the
    // markers of everyone dropped from it.
    const removal = db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('project')
        .select('id')
        .where('id', '=', created.project.id)
        .forUpdate()
        .execute();
      held();
      await released;
      const result = await trx
        .deleteFrom('project_user_seen')
        .where('project_id', '=', created.project.id)
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    });
    await holding;

    const stamping = stamp(editor, created.project.id);
    const outcome = await Promise.race([
      stamping,
      new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 1000)),
    ]);
    release();

    expect(await removal).toBe(1);
    expect(await stamping).toBe(204);
    // A project lock in the stamp would put the two writers in opposite orders
    // over the same pair of rows, which is the shape that deadlocks.
    expect(outcome).toBe(204);
  });
});
