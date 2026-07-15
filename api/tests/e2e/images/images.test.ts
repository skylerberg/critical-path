import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { describe, it, expect, afterAll } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { db } from '../../../src/db/index';
import { env } from '../../../src/config/env';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64'
);
const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const WEBP_1X1 = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

function imageForm(bytes: Buffer, filename: string, mimeType: string, id?: string): FormData {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], filename, { type: mimeType }));
  if (id !== undefined) {
    form.append('id', id);
  }
  return form;
}

describe('Images', () => {
  const ctx = new TestContext();
  const createdProjectIds: string[] = [];

  async function createTaskFixture(ownerId: string): Promise<string> {
    const projectId = newId();
    const columnId = newId();
    const taskId = newId();

    await db
      .insertInto('project')
      .values({ id: projectId, name: 'images test project', created_by: ownerId })
      .execute();
    await db
      .insertInto('board_column')
      .values({ id: columnId, project_id: projectId, name: 'To Do', position: 1000 })
      .execute();
    await db
      .insertInto('task')
      .values({
        id: taskId,
        project_id: projectId,
        column_id: columnId,
        title: 'task',
        position: 1000,
      })
      .execute();

    createdProjectIds.push(projectId);
    return taskId;
  }

  afterAll(async () => {
    if (createdProjectIds.length > 0) {
      const rows = await db
        .selectFrom('task_image')
        .innerJoin('task', 'task.id', 'task_image.task_id')
        .select('task_image.storage_key')
        .where('task.project_id', 'in', createdProjectIds)
        .execute();
      await Promise.all(
        rows.map((row) => fs.rm(path.join(env.storageDiskRoot, row.storage_key), { force: true }))
      );
      await db.deleteFrom('project').where('id', 'in', createdProjectIds).execute();
    }
    await ctx.cleanup();
  });

  describe('POST /api/tasks/:id/images', () => {
    it('uploads a PNG and sniffs image/png', async () => {
      const user = await ctx.createUser('img-png');
      const taskId = await createTaskFixture(user.id);
      const imageId = newId();

      const res = await ctx
        .request(user.token)
        .postMultipart(
          `/api/tasks/${taskId}/images`,
          imageForm(PNG_1X1, 'pixel.png', 'image/png', imageId)
        );
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body).toEqual({
        id: imageId,
        url: `/api/images/${imageId}`,
        filename: 'pixel.png',
        content_type: 'image/png',
        size_bytes: PNG_1X1.length,
        created_at: expect.any(String),
      });
    });

    it('uploads a JPEG and sniffs image/jpeg', async () => {
      const user = await ctx.createUser('img-jpeg');
      const taskId = await createTaskFixture(user.id);

      const res = await ctx
        .request(user.token)
        .postMultipart(
          `/api/tasks/${taskId}/images`,
          imageForm(JPEG_1X1, 'pixel.jpg', 'image/jpeg')
        );
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.content_type).toBe('image/jpeg');
      expect(body.size_bytes).toBe(JPEG_1X1.length);
      expect(body.url).toBe(`/api/images/${body.id}`);
    });

    it('uploads a GIF and sniffs image/gif', async () => {
      const user = await ctx.createUser('img-gif');
      const taskId = await createTaskFixture(user.id);

      const res = await ctx
        .request(user.token)
        .postMultipart(`/api/tasks/${taskId}/images`, imageForm(GIF_1X1, 'pixel.gif', 'image/gif'));
      expect(res.status).toBe(201);
      expect((await res.json()).content_type).toBe('image/gif');
    });

    it('uploads a WebP and sniffs image/webp', async () => {
      const user = await ctx.createUser('img-webp');
      const taskId = await createTaskFixture(user.id);

      const res = await ctx
        .request(user.token)
        .postMultipart(
          `/api/tasks/${taskId}/images`,
          imageForm(WEBP_1X1, 'pixel.webp', 'image/webp')
        );
      expect(res.status).toBe(201);
      expect((await res.json()).content_type).toBe('image/webp');
    });

    it('stores the sniffed type for a GIF/HTML polyglot, never the declared text/html', async () => {
      const user = await ctx.createUser('img-polyglot');
      const taskId = await createTaskFixture(user.id);

      const polyglot = Buffer.concat([
        Buffer.from('GIF89a', 'latin1'),
        Buffer.from('<html><script>alert(1)</script></html>'),
      ]);
      const res = await ctx
        .request(user.token)
        .postMultipart(
          `/api/tasks/${taskId}/images`,
          imageForm(polyglot, 'evil.html', 'text/html')
        );
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.content_type).toBe('image/gif');

      const row = await db
        .selectFrom('task_image')
        .select('content_type')
        .where('id', '=', body.id)
        .executeTakeFirstOrThrow();
      expect(row.content_type).toBe('image/gif');
    });

    it('rejects bytes that match no supported format with 422', async () => {
      const user = await ctx.createUser('img-garbage');
      const taskId = await createTaskFixture(user.id);

      const res = await ctx
        .request(user.token)
        .postMultipart(
          `/api/tasks/${taskId}/images`,
          imageForm(Buffer.from('definitely not an image'), 'fake.png', 'image/png')
        );
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBeTypeOf('string');
    });

    it('rejects files over 10 MB with 413', async () => {
      const user = await ctx.createUser('img-toobig');
      const taskId = await createTaskFixture(user.id);

      const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
      PNG_1X1.copy(oversized);
      const res = await ctx
        .request(user.token)
        .postMultipart(`/api/tasks/${taskId}/images`, imageForm(oversized, 'big.png', 'image/png'));
      expect(res.status).toBe(413);
    });

    it('rejects request bodies over the 11 MB route limit with 413', async () => {
      const user = await ctx.createUser('img-body-limit');
      const taskId = await createTaskFixture(user.id);

      const oversized = Buffer.alloc(11 * 1024 * 1024 + 1024);
      const res = await ctx
        .request(user.token)
        .postMultipart(
          `/api/tasks/${taskId}/images`,
          imageForm(oversized, 'huge.png', 'image/png')
        );
      expect(res.status).toBe(413);
    });

    it('returns 404 for a nonexistent task', async () => {
      const user = await ctx.createUser('img-no-task');

      const res = await ctx
        .request(user.token)
        .postMultipart(
          `/api/tasks/${newId()}/images`,
          imageForm(PNG_1X1, 'pixel.png', 'image/png')
        );
      expect(res.status).toBe(404);
    });

    it('requires auth', async () => {
      const user = await ctx.createUser('img-upload-anon');
      const taskId = await createTaskFixture(user.id);

      const res = await ctx
        .request()
        .postMultipart(`/api/tasks/${taskId}/images`, imageForm(PNG_1X1, 'pixel.png', 'image/png'));
      expect(res.status).toBe(401);
    });

    it('returns 400 when the file field is missing', async () => {
      const user = await ctx.createUser('img-no-file');
      const taskId = await createTaskFixture(user.id);

      const form = new FormData();
      form.append('id', newId());
      const res = await ctx.request(user.token).postMultipart(`/api/tasks/${taskId}/images`, form);
      expect(res.status).toBe(400);
    });

    it('returns 422 for a malformed id field', async () => {
      const user = await ctx.createUser('img-bad-id');
      const taskId = await createTaskFixture(user.id);

      const res = await ctx
        .request(user.token)
        .postMultipart(
          `/api/tasks/${taskId}/images`,
          imageForm(PNG_1X1, 'pixel.png', 'image/png', 'not-a-uuid')
        );
      expect(res.status).toBe(422);
    });

    it('returns 409 for a duplicate image id', async () => {
      const user = await ctx.createUser('img-dup');
      const taskId = await createTaskFixture(user.id);
      const imageId = newId();

      const first = await ctx
        .request(user.token)
        .postMultipart(
          `/api/tasks/${taskId}/images`,
          imageForm(PNG_1X1, 'pixel.png', 'image/png', imageId)
        );
      expect(first.status).toBe(201);

      const second = await ctx
        .request(user.token)
        .postMultipart(
          `/api/tasks/${taskId}/images`,
          imageForm(GIF_1X1, 'pixel.gif', 'image/gif', imageId)
        );
      expect(second.status).toBe(409);
    });
  });

  describe('GET /api/images/:id', () => {
    it('serves the uploaded bytes without auth, with stored Content-Type and immutable Cache-Control', async () => {
      const user = await ctx.createUser('img-get');
      const taskId = await createTaskFixture(user.id);

      const upload = await ctx
        .request(user.token)
        .postMultipart(`/api/tasks/${taskId}/images`, imageForm(PNG_1X1, 'pixel.png', 'image/png'));
      expect(upload.status).toBe(201);
      const { id } = await upload.json();

      const res = await ctx.request().get(`/api/images/${id}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
      expect(Buffer.from(await res.arrayBuffer()).equals(PNG_1X1)).toBe(true);
    });

    it('serves the sniffed Content-Type for spoofed uploads', async () => {
      const user = await ctx.createUser('img-get-spoof');
      const taskId = await createTaskFixture(user.id);

      const polyglot = Buffer.concat([
        Buffer.from('GIF89a', 'latin1'),
        Buffer.from('<html></html>'),
      ]);
      const upload = await ctx
        .request(user.token)
        .postMultipart(
          `/api/tasks/${taskId}/images`,
          imageForm(polyglot, 'evil.html', 'text/html')
        );
      expect(upload.status).toBe(201);
      const { id } = await upload.json();

      const res = await ctx.request().get(`/api/images/${id}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/gif');
    });

    it('returns 404 for an unknown image', async () => {
      const res = await ctx.request().get(`/api/images/${newId()}`);
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/images/:id', () => {
    it('deletes the row and removes the stored file', async () => {
      const user = await ctx.createUser('img-delete');
      const taskId = await createTaskFixture(user.id);

      const upload = await ctx
        .request(user.token)
        .postMultipart(
          `/api/tasks/${taskId}/images`,
          imageForm(WEBP_1X1, 'pixel.webp', 'image/webp')
        );
      expect(upload.status).toBe(201);
      const { id } = await upload.json();

      const row = await db
        .selectFrom('task_image')
        .select('storage_key')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      const filePath = path.join(env.storageDiskRoot, row.storage_key);
      expect(existsSync(filePath)).toBe(true);

      const res = await ctx.request(user.token).delete(`/api/images/${id}`);
      expect(res.status).toBe(204);

      const remaining = await db
        .selectFrom('task_image')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      expect(remaining).toBeUndefined();

      // Storage deletion runs in a post-commit hook that is not awaited.
      await expect.poll(() => existsSync(filePath), { timeout: 5000 }).toBe(false);

      const get = await ctx.request().get(`/api/images/${id}`);
      expect(get.status).toBe(404);
    });

    it('requires auth', async () => {
      const user = await ctx.createUser('img-delete-auth');
      const taskId = await createTaskFixture(user.id);

      const upload = await ctx
        .request(user.token)
        .postMultipart(`/api/tasks/${taskId}/images`, imageForm(PNG_1X1, 'pixel.png', 'image/png'));
      const { id } = await upload.json();

      const res = await ctx.request().delete(`/api/images/${id}`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown image', async () => {
      const user = await ctx.createUser('img-delete-404');
      const res = await ctx.request(user.token).delete(`/api/images/${newId()}`);
      expect(res.status).toBe(404);
    });
  });
});
