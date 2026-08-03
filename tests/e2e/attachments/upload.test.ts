import { describe, it, expect, afterAll } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { db } from '../../../src/db/index';
import { env } from '../../../src/config/env';
import {
  cleanupProjects,
  createTaskFixture,
  listStorageKeys,
  storedKeyExists,
  streamOf,
  uploadPath,
} from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');
const ZIP = Buffer.concat([Buffer.from('PK'), Buffer.alloc(64, 7)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<html><body><script>alert(document.cookie)</script></body></html>');
const POLYGLOT = Buffer.concat([
  Buffer.from('GIF89a', 'latin1'),
  Buffer.from('<html><script>alert(1)</script></html>'),
]);
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('POST /api/attachments/files', () => {
  const ctx = new TestContext();
  const createdProjectIds: string[] = [];

  afterAll(async () => {
    await cleanupProjects(createdProjectIds);
    await ctx.cleanup();
  });

  it.each([
    ['a PDF', PDF, 'spec.pdf', 'application/pdf', 'application/pdf'],
    ['a zip', ZIP, 'bundle.zip', 'application/zip', 'application/zip'],
    ['a text file', Buffer.from('hello'), 'notes.txt', 'text/plain', 'text/plain'],
    ['a file with no extension', Buffer.from('data'), 'LICENSE', '', 'application/octet-stream'],
    ['an SVG with a script', SVG, 'evil.svg', 'image/svg+xml', 'image/svg+xml'],
    ['an HTML file', HTML, 'evil.html', 'text/html', 'text/html'],
    ['a GIF/HTML polyglot', POLYGLOT, 'evil.gif', 'image/gif', 'image/gif'],
  ])('accepts %s', async (_label, bytes, filename, declared, storedType) => {
    const user = await ctx.createUser('att-up');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, filename, declared), bytes);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body).toMatchObject({
      task_id: taskId,
      kind: 'file',
      filename,
      content_type: storedType,
      size_bytes: bytes.length,
      url: null,
      preview_url: null,
      favicon_url: null,
      unfurl_state: null,
    });
  });

  // Without the upload path in the global body-limit exemption every real upload
  // 413s before the route's own, larger limit is ever reached.
  it('accepts an upload well past the global 1 MB body limit', async () => {
    const user = await ctx.createUser('att-big');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const big = Buffer.alloc(3 * 1024 * 1024, 0x41);

    const res = await ctx.request(user.token).postBytes(uploadPath(taskId, 'big.bin'), big);

    expect(res.status).toBe(201);
    expect((await res.json()).size_bytes).toBe(big.length);
  });

  it('refuses an empty file with 422', async () => {
    const user = await ctx.createUser('att-empty');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, 'empty.txt', 'text/plain'), Buffer.alloc(0));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('File is empty');
  });

  it('leaves no storage object behind when the file is empty', async () => {
    const user = await ctx.createUser('att-empty2');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const before = await listStorageKeys();
    const res = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, 'empty.txt'), streamOf(Buffer.alloc(0), 0));
    expect(res.status).toBe(422);

    const after = await listStorageKeys();
    expect([...after].filter((key) => !before.has(key))).toEqual([]);
  });

  it('refuses a file over ATTACHMENT_MAX_BYTES with 413', async () => {
    const user = await ctx.createUser('att-max');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const previous = process.env.ATTACHMENT_MAX_BYTES;
    process.env.ATTACHMENT_MAX_BYTES = '1024';
    try {
      const res = await ctx
        .request(user.token)
        .postBytes(uploadPath(taskId, 'big.bin'), Buffer.alloc(4096, 1));
      expect(res.status).toBe(413);
      expect(
        await db.selectFrom('task_attachment').selectAll().where('task_id', '=', taskId).execute()
      ).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.ATTACHMENT_MAX_BYTES;
      else process.env.ATTACHMENT_MAX_BYTES = previous;
    }
  });

  // The cap has to hold for a body whose length is not declared up front, which
  // is the case the pre-check cannot see and the reason the stream is counted.
  it('cuts off a chunked upload that passes the cap and stores nothing', async () => {
    const user = await ctx.createUser('att-chunked');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const previous = process.env.ATTACHMENT_MAX_BYTES;
    process.env.ATTACHMENT_MAX_BYTES = '4096';
    try {
      const before = await listStorageKeys();
      const res = await ctx
        .request(user.token)
        .postBytes(uploadPath(taskId, 'stream.bin'), streamOf(Buffer.alloc(1024, 9), 64));

      expect(res.status).toBe(413);
      expect(
        await db.selectFrom('task_attachment').selectAll().where('task_id', '=', taskId).execute()
      ).toHaveLength(0);

      const after = await listStorageKeys();
      expect([...after].filter((key) => !before.has(key))).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.ATTACHMENT_MAX_BYTES;
      else process.env.ATTACHMENT_MAX_BYTES = previous;
    }
  });

  it('accepts a chunked upload that stays under the cap', async () => {
    const user = await ctx.createUser('att-chunkok');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, 'stream.bin'), streamOf(Buffer.alloc(1024, 3), 8));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.size_bytes).toBe(8 * 1024);

    const row = await db
      .selectFrom('task_attachment')
      .select('storage_key')
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow();
    expect(await storedKeyExists(row.storage_key as string)).toBe(true);
  });

  it('refuses the 51st attachment on a task', async () => {
    const user = await ctx.createUser('att-count');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    await db
      .insertInto('task_attachment')
      .values(
        Array.from({ length: 50 }, () => ({
          id: newId(),
          task_id: taskId,
          kind: 'link',
          url: 'https://example.com/',
          unfurl_state: 'failed',
        }))
      )
      .execute();

    const res = await ctx.request(user.token).postBytes(uploadPath(taskId, 'x.pdf'), PDF);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain('at most 50 attachments');
  });

  it('honours a client-supplied id and answers 409 for a duplicate', async () => {
    const user = await ctx.createUser('att-id');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const id = newId();

    const first = await ctx.request(user.token).postBytes(uploadPath(taskId, 'a.pdf', '', id), PDF);
    expect(first.status).toBe(201);
    expect((await first.json()).id).toBe(id);

    const second = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, 'b.pdf', '', id), PDF);
    expect(second.status).toBe(409);
  });

  it('refuses a malformed task_id or id with 400', async () => {
    const user = await ctx.createUser('att-uuid');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const badTask = await ctx.request(user.token).postBytes(uploadPath('not-a-uuid', 'a.pdf'), PDF);
    expect(badTask.status).toBe(400);

    const badId = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, 'a.pdf', '', 'nope'), PDF);
    expect(badId.status).toBe(400);
  });

  it('refuses a request with no task_id with 400', async () => {
    const user = await ctx.createUser('att-notask');
    await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx.request(user.token).postBytes('/api/attachments/files', PDF);
    expect(res.status).toBe(400);
  });

  it('answers 404 for an unknown or inaccessible task and 403 for a viewer', async () => {
    const owner = await ctx.createUser('att-owner');
    const stranger = await ctx.createUser('att-stranger');
    const viewer = await ctx.createUser('att-viewer');
    const { projectId, taskId } = await createTaskFixture(owner.id, createdProjectIds);
    await db
      .insertInto('project_member')
      .values({ project_id: projectId, user_id: viewer.id, role: 'viewer' })
      .execute();

    const unknown = await ctx.request(owner.token).postBytes(uploadPath(newId(), 'a.pdf'), PDF);
    expect(unknown.status).toBe(404);

    const outsider = await ctx.request(stranger.token).postBytes(uploadPath(taskId, 'a.pdf'), PDF);
    expect(outsider.status).toBe(404);

    const readOnly = await ctx.request(viewer.token).postBytes(uploadPath(taskId, 'a.pdf'), PDF);
    expect(readOnly.status).toBe(403);
  });

  // The bytes must never reach storage for a caller who may not write, which
  // only holds while every check precedes the stream.
  it('writes no storage object for a rejected caller', async () => {
    const owner = await ctx.createUser('att-nowrite');
    const viewer = await ctx.createUser('att-nowrite2');
    const { projectId, taskId } = await createTaskFixture(owner.id, createdProjectIds);
    await db
      .insertInto('project_member')
      .values({ project_id: projectId, user_id: viewer.id, role: 'viewer' })
      .execute();

    const before = await listStorageKeys();
    const res = await ctx
      .request(viewer.token)
      .postBytes(uploadPath(taskId, 'a.pdf'), Buffer.alloc(4096, 2));
    expect(res.status).toBe(403);

    const after = await listStorageKeys();
    expect([...after].filter((key) => !before.has(key))).toEqual([]);
  });

  it('answers 401 without a token', async () => {
    const user = await ctx.createUser('att-anon');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx.request().postBytes(uploadPath(taskId, 'a.pdf'), PDF);
    expect(res.status).toBe(401);
  });

  it('stores the sanitised declared MIME type, whatever the bytes are', async () => {
    const user = await ctx.createUser('att-mime');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, 'lies.pdf', 'text/html; charset=utf-8'), PDF);
    expect(res.status).toBe(201);
    expect((await res.json()).content_type).toBe('text/html');
  });

  it('sanitises a path-shaped filename down to its basename', async () => {
    const user = await ctx.createUser('att-name');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, '../../etc/pas"swd.pdf'), PDF);
    expect(res.status).toBe(201);
    expect((await res.json()).filename).toBe('passwd.pdf');
  });

  it('falls back to a placeholder filename when none is supplied', async () => {
    const user = await ctx.createUser('att-noname');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx.request(user.token).postBytes(uploadPath(taskId), PDF);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.filename).toBe('attachment');
    expect(body.content_type).toBe('application/octet-stream');
  });

  describe('project storage quota', () => {
    it('refuses an upload past the quota and writes no storage object', async () => {
      const user = await ctx.createUser('att-quota');
      const { taskId } = await createTaskFixture(user.id, createdProjectIds);
      const previous = process.env.PROJECT_STORAGE_QUOTA_BYTES;
      process.env.PROJECT_STORAGE_QUOTA_BYTES = '2048';
      try {
        const fits = await ctx
          .request(user.token)
          .postBytes(uploadPath(taskId, 'fits.bin'), Buffer.alloc(2000, 3));
        expect(fits.status).toBe(201);

        const before = await listStorageKeys();
        const overflows = await ctx
          .request(user.token)
          .postBytes(uploadPath(taskId, 'over.bin'), Buffer.alloc(100, 4));
        expect(overflows.status).toBe(413);
        expect((await overflows.json()).error).toContain('storage quota');

        const after = await listStorageKeys();
        expect([...after].filter((key) => !before.has(key))).toEqual([]);
      } finally {
        if (previous === undefined) delete process.env.PROJECT_STORAGE_QUOTA_BYTES;
        else process.env.PROJECT_STORAGE_QUOTA_BYTES = previous;
      }
    });

    // A body with no declared length gets past the pre-check, so the quota has
    // to be what cuts the stream off and what reclaims the partial object.
    it('cuts off a chunked upload that would pass the quota', async () => {
      const user = await ctx.createUser('att-quota3');
      const { taskId } = await createTaskFixture(user.id, createdProjectIds);
      const previous = process.env.PROJECT_STORAGE_QUOTA_BYTES;
      process.env.PROJECT_STORAGE_QUOTA_BYTES = '4096';
      try {
        const before = await listStorageKeys();
        const res = await ctx
          .request(user.token)
          .postBytes(uploadPath(taskId, 'over.bin'), streamOf(Buffer.alloc(1024, 6), 16));

        expect(res.status).toBe(413);
        expect((await res.json()).error).toContain('storage quota');

        const after = await listStorageKeys();
        expect([...after].filter((key) => !before.has(key))).toEqual([]);
      } finally {
        if (previous === undefined) delete process.env.PROJECT_STORAGE_QUOTA_BYTES;
        else process.env.PROJECT_STORAGE_QUOTA_BYTES = previous;
      }
    });

    it('counts image bytes toward the same quota, from both directions', async () => {
      const user = await ctx.createUser('att-quota2');
      const { taskId } = await createTaskFixture(user.id, createdProjectIds);
      const previous = process.env.PROJECT_STORAGE_QUOTA_BYTES;
      process.env.PROJECT_STORAGE_QUOTA_BYTES = String(PNG_1X1.length + 10);
      try {
        const image = await ctx.request(user.token).postMultipart(
          `/api/tasks/${taskId}/images`,
          (() => {
            const form = new FormData();
            form.append(
              'file',
              new File([new Uint8Array(PNG_1X1)], 'p.png', { type: 'image/png' })
            );
            return form;
          })()
        );
        expect(image.status).toBe(201);

        const attachment = await ctx
          .request(user.token)
          .postBytes(uploadPath(taskId, 'over.bin'), Buffer.alloc(64, 5));
        expect(attachment.status).toBe(413);

        const secondImage = await ctx.request(user.token).postMultipart(
          `/api/tasks/${taskId}/images`,
          (() => {
            const form = new FormData();
            form.append(
              'file',
              new File([new Uint8Array(PNG_1X1)], 'q.png', { type: 'image/png' })
            );
            return form;
          })()
        );
        expect(secondImage.status).toBe(413);
      } finally {
        if (previous === undefined) delete process.env.PROJECT_STORAGE_QUOTA_BYTES;
        else process.env.PROJECT_STORAGE_QUOTA_BYTES = previous;
      }
    });
  });

  it('embeds attachments in the task detail payload in creation order', async () => {
    const user = await ctx.createUser('att-detail');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const first = await ctx.request(user.token).postBytes(uploadPath(taskId, 'one.pdf'), PDF);
    expect(first.status).toBe(201);
    const second = await ctx.request(user.token).postBytes(uploadPath(taskId, 'two.zip'), ZIP);
    expect(second.status).toBe(201);

    const detail = await ctx.request(user.token).get(`/api/tasks/${taskId}`);
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.attachments.map((a: { filename: string }) => a.filename)).toEqual([
      'one.pdf',
      'two.zip',
    ]);
  });

  it('writes the bytes verbatim to storage', async () => {
    const user = await ctx.createUser('att-bytes');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx.request(user.token).postBytes(uploadPath(taskId, 'x.svg'), SVG);
    const { id } = await res.json();

    const row = await db
      .selectFrom('task_attachment')
      .select('storage_key')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.storage_key).not.toBeNull();
    expect(await storedKeyExists(row.storage_key as string)).toBe(true);
    expect(env.attachmentMaxBytes).toBe(50 * 1024 * 1024);
  });
});
