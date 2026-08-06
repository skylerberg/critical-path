import { promises as fs } from 'fs';
import { describe, it, expect, afterAll, vi } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { db } from '../../../src/db/index';
import { storage } from '../../../src/services/storage/index';
import { storageKeysOwnedBy } from '../../../src/services/accountDeletion';
import { copyTasks } from '../../../src/services/projectCopy';
import { insertTaskImages } from '../../../src/services/attachments/images';
import {
  cleanupProjects,
  clearUnfurlJobs,
  createTaskFixture,
  storagePath,
  storedKeyExists,
  uploadPath,
} from './helpers';
import { rankKey } from '../../helpers/fixtures';

const PDF = Buffer.from('%PDF-1.4\nbody\n%%EOF\n');

// Post-commit hooks are fire-and-forget, so the reclaim they schedule lands a
// tick or two after the response.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

describe('Attachment lifecycle', () => {
  const ctx = new TestContext();
  const createdProjectIds: string[] = [];

  afterAll(async () => {
    await clearUnfurlJobs();
    await cleanupProjects(createdProjectIds);
    await ctx.cleanup();
  });

  async function attachEverything(
    token: string,
    taskId: string
  ): Promise<{ fileId: string; linkId: string; keys: string[] }> {
    const upload = await ctx.request(token).postBytes(uploadPath(taskId, 'spec.pdf'), PDF);
    expect(upload.status).toBe(201);
    const fileId = (await upload.json()).id;

    const linkId = newId();
    const previewKey = newId();
    const faviconKey = newId();
    await storage.put(previewKey, Buffer.from('preview'), 'image/webp');
    await storage.put(faviconKey, Buffer.from('favicon'), 'image/webp');
    await db
      .insertInto('task_attachment')
      .values({
        id: linkId,
        task_id: taskId,
        kind: 'link',
        url: 'https://example.com/doc',
        title: 'Doc',
        description: 'A doc',
        unfurl_state: 'ok',
        preview_storage_key: previewKey,
        favicon_storage_key: faviconKey,
      })
      .execute();

    const row = await db
      .selectFrom('task_attachment')
      .select('storage_key')
      .where('id', '=', fileId)
      .executeTakeFirstOrThrow();

    return { fileId, linkId, keys: [row.storage_key as string, previewKey, faviconKey] };
  }

  it('reclaims every object kind when the task is deleted', async () => {
    const user = await ctx.createUser('life-task');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const { keys } = await attachEverything(user.token, taskId);

    expect((await ctx.request(user.token).post(`/api/tasks/${taskId}/archive`)).status).toBe(200);
    expect((await ctx.request(user.token).delete(`/api/tasks/${taskId}`)).status).toBe(204);
    await settle();

    expect(
      await db.selectFrom('task_attachment').selectAll().where('task_id', '=', taskId).execute()
    ).toHaveLength(0);
    for (const key of keys) {
      expect(await storedKeyExists(key)).toBe(false);
    }
  });

  it('reclaims every object kind when the project is deleted', async () => {
    const user = await ctx.createUser('life-project');
    const { projectId, taskId } = await createTaskFixture(user.id, createdProjectIds);
    const { keys } = await attachEverything(user.token, taskId);

    expect((await ctx.request(user.token).delete(`/api/projects/${projectId}`)).status).toBe(204);
    await settle();

    for (const key of keys) {
      expect(await storedKeyExists(key)).toBe(false);
    }
  });

  it('reclaims attachments when the attachment row itself is deleted', async () => {
    const user = await ctx.createUser('life-row');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const { linkId, keys } = await attachEverything(user.token, taskId);

    expect((await ctx.request(user.token).delete(`/api/attachments/${linkId}`)).status).toBe(204);
    await settle();

    expect(await storedKeyExists(keys[0])).toBe(true);
    expect(await storedKeyExists(keys[1])).toBe(false);
    expect(await storedKeyExists(keys[2])).toBe(false);
  });

  describe('copying', () => {
    async function assertCopied(sourceTaskId: string, destTaskId: string): Promise<void> {
      const source = await db
        .selectFrom('task_attachment')
        .selectAll()
        .where('task_id', '=', sourceTaskId)
        .orderBy('kind')
        .execute();
      const dest = await db
        .selectFrom('task_attachment')
        .selectAll()
        .where('task_id', '=', destTaskId)
        .orderBy('kind')
        .execute();

      expect(dest).toHaveLength(source.length);
      for (const [index, copy] of dest.entries()) {
        const original = source[index];
        expect(copy.id).not.toBe(original.id);
        expect(copy.kind).toBe(original.kind);
        expect(copy.title).toBe(original.title);
        expect(copy.description).toBe(original.description);
        expect(copy.url).toBe(original.url);
        expect(copy.unfurl_state).toBe(original.unfurl_state);
        expect(copy.filename).toBe(original.filename);

        for (const column of [
          'storage_key',
          'preview_storage_key',
          'favicon_storage_key',
        ] as const) {
          const sourceKey = original[column];
          const copyKey = copy[column];
          if (sourceKey === null) {
            expect(copyKey).toBeNull();
            continue;
          }
          expect(copyKey).not.toBe(sourceKey);
          expect(await storedKeyExists(sourceKey)).toBe(true);
          const originalBytes = await storage.get(sourceKey);
          const copiedBytes = await storage.get(copyKey as string);
          expect(copiedBytes).not.toBeNull();
          expect((copiedBytes as Buffer).equals(originalBytes as Buffer)).toBe(true);
        }
      }
    }

    it('carries file and link attachments through a task duplicate without re-unfurling', async () => {
      const user = await ctx.createUser('copy-task');
      const { taskId } = await createTaskFixture(user.id, createdProjectIds);
      await attachEverything(user.token, taskId);
      await clearUnfurlJobs();

      const copyId = newId();
      const res = await ctx
        .request(user.token)
        .post(`/api/tasks/${taskId}/duplicate`, { id: copyId, sort_key: rankKey(2000) });
      expect(res.status).toBe(201);

      await assertCopied(taskId, copyId);
      expect(
        await db.selectFrom('job').selectAll().where('kind', '=', 'attachment_unfurl').execute()
      ).toHaveLength(0);
    });

    it('carries them through a column duplicate', async () => {
      const user = await ctx.createUser('copy-column');
      const { columnId, taskId } = await createTaskFixture(user.id, createdProjectIds);
      await attachEverything(user.token, taskId);

      const res = await ctx
        .request(user.token)
        .post(`/api/columns/${columnId}/duplicate`, { id: newId(), sort_key: rankKey(5000) });
      expect(res.status).toBe(201);

      const copies = await res.json();
      expect(copies.tasks).toHaveLength(1);
      await assertCopied(taskId, copies.tasks[0].id);
    });

    it('carries them through a project created from a copy', async () => {
      const user = await ctx.createUser('copy-project');
      const { projectId, taskId } = await createTaskFixture(user.id, createdProjectIds);
      await attachEverything(user.token, taskId);

      const newProjectId = newId();
      const res = await ctx.request(user.token).post('/api/projects', {
        id: newProjectId,
        name: 'Copied project',
        source_project_id: projectId,
      });
      expect(res.status).toBe(201);
      createdProjectIds.push(newProjectId);

      const copied = await db
        .selectFrom('task')
        .select('task.id')
        .where('task.project_id', '=', newProjectId)
        .executeTakeFirstOrThrow();
      await assertCopied(taskId, copied.id);
    });

    // Nothing re-unfurls a copy, so carrying 'pending' across would spin forever.
    it('settles a copy of a link that was still unfurling', async () => {
      const user = await ctx.createUser('copy-pending');
      const { taskId } = await createTaskFixture(user.id, createdProjectIds);
      await db
        .insertInto('task_attachment')
        .values({
          id: newId(),
          task_id: taskId,
          kind: 'link',
          url: 'https://example.com/mid-flight',
          unfurl_state: 'pending',
        })
        .execute();

      const copyId = newId();
      const res = await ctx
        .request(user.token)
        .post(`/api/tasks/${taskId}/duplicate`, { id: copyId, sort_key: rankKey(3000) });
      expect(res.status).toBe(201);

      const copy = await db
        .selectFrom('task_attachment')
        .select(['unfurl_state', 'url'])
        .where('task_id', '=', copyId)
        .executeTakeFirstOrThrow();
      expect(copy.unfurl_state).toBe('failed');
      expect(copy.url).toBe('https://example.com/mid-flight');
      expect(
        await db.selectFrom('job').selectAll().where('kind', '=', 'attachment_unfurl').execute()
      ).toHaveLength(0);
    });

    // The reclaim list is hoisted over images and attachments together; a
    // separate list per kind would strand whichever half ran first.
    it('reclaims both image and attachment copies when a copy fails part way', async () => {
      const user = await ctx.createUser('copy-fail');
      const { projectId, columnId, taskId } = await createTaskFixture(user.id, createdProjectIds);
      await attachEverything(user.token, taskId);

      const imageKey = newId();
      const imageId = newId();
      await storage.put(imageKey, Buffer.from('image'), 'image/png');
      await insertTaskImages(db, [
        {
          id: imageId,
          task_id: taskId,
          storage_key: imageKey,
          filename: 'p.png',
          content_type: 'image/png',
          size_bytes: 5,
          is_cover: false,
        },
      ]);

      const attempted: string[] = [];
      const copySpy = vi
        .spyOn(storage, 'copy')
        .mockImplementation(async (_source: string, dest: string) => {
          attempted.push(dest);
          if (attempted.length >= 2) {
            throw new Error('storage exploded');
          }
          await storage.put(dest, Buffer.from('partial'), 'application/octet-stream');
        });

      try {
        await expect(
          db.transaction().execute((trx) =>
            copyTasks(trx, {
              sourceTaskIds: [taskId],
              projectId,
              actorUserId: user.id,
              columnIdFor: () => columnId,
              copyAssignees: false,
            })
          )
        ).rejects.toThrow('storage exploded');
      } finally {
        copySpy.mockRestore();
      }

      expect(attempted.length).toBeGreaterThanOrEqual(2);
      for (const key of attempted) {
        expect(await storedKeyExists(key)).toBe(false);
      }
    });
  });

  describe('account deletion', () => {
    it('reclaims attachments in projects the user created and leaves the rest alone', async () => {
      const owner = await ctx.createUser('life-owner');
      const other = await ctx.createUser('life-other');

      const mine = await createTaskFixture(owner.id, createdProjectIds, 'owned');
      const theirs = await createTaskFixture(other.id, createdProjectIds, 'joined');
      await db
        .insertInto('project_member')
        .values({ project_id: theirs.projectId, user_id: owner.id, role: 'editor' })
        .execute();

      const ownKeys = (await attachEverything(owner.token, mine.taskId)).keys;
      const foreignKeys = (await attachEverything(owner.token, theirs.taskId)).keys;

      const keys = await storageKeysOwnedBy(db, owner.id, null);

      for (const key of ownKeys) {
        expect(keys).toContain(key);
      }
      for (const key of foreignKeys) {
        expect(keys).not.toContain(key);
      }
    });
  });

  it('keeps the attachment rows when the task is archived', async () => {
    const user = await ctx.createUser('life-archive');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const { keys } = await attachEverything(user.token, taskId);

    expect((await ctx.request(user.token).post(`/api/tasks/${taskId}/archive`)).status).toBe(200);
    await settle();

    const detail = await ctx.request(user.token).get(`/api/tasks/${taskId}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).attachments).toHaveLength(2);
    expect(await storedKeyExists(keys[0])).toBe(true);
  });

  it('lists file attachments in the export archive and manifest', async () => {
    const user = await ctx.createUser('life-export');
    const { projectId, taskId } = await createTaskFixture(user.id, createdProjectIds);
    const { fileId, linkId } = await attachEverything(user.token, taskId);

    const json = await ctx.request(user.token).get(`/api/projects/${projectId}/export?format=json`);
    expect(json.status).toBe(200);
    const manifest = await json.json();
    expect(manifest.version).toBe(4);

    const attachments = manifest.tasks.flatMap(
      (task: { attachments: unknown[] }) => task.attachments
    );
    expect(attachments).toHaveLength(2);
    expect(attachments).toContainEqual(
      expect.objectContaining({ id: fileId, kind: 'file', path: `attachments/${fileId}.pdf` })
    );
    expect(attachments).toContainEqual(
      expect.objectContaining({
        id: linkId,
        kind: 'link',
        path: null,
        url: 'https://example.com/doc',
        unfurl_state: 'ok',
      })
    );

    const zip = await ctx.request(user.token).get(`/api/projects/${projectId}/export`);
    expect(zip.status).toBe(200);
    const bytes = Buffer.from(await zip.arrayBuffer());
    expect(bytes.includes(Buffer.from(`attachments/${fileId}.pdf`))).toBe(true);
    expect(bytes.includes(PDF)).toBe(true);
  });

  it('cleans up after itself', async () => {
    const user = await ctx.createUser('life-clean');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const { keys } = await attachEverything(user.token, taskId);
    await Promise.all(keys.map((key) => fs.rm(storagePath(key), { force: true })));
    expect(await storedKeyExists(keys[0])).toBe(false);
  });
});
