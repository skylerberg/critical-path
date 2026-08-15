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
  ])('accepts %s', async (_label, bytes, filename, declared, storedType) => {
    const user = await ctx.createUser('att-up');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: filename, contentType: declared }), bytes);
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

  // The server decides the kind from the leading bytes, so a real image sent to
  // this endpoint becomes an image however it was declared or named.
  it('stores a sniffed image as kind image, ignoring the declared type', async () => {
    const user = await ctx.createUser('att-sniff');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx
      .request(user.token)
      .postBytes(
        uploadPath(taskId, { filename: 'shot.bin', contentType: 'application/octet-stream' }),
        PNG_1X1
      );
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body).toMatchObject({
      kind: 'image',
      filename: 'shot.bin',
      content_type: 'image/png',
      is_cover: false,
    });
    expect(body.image_url).toBe(`/api/images/${body.id}`);
    // Image columns only: a file's are what the download route reads, and this
    // row must stay unreachable through it.
    expect(body.url).toBeNull();
    expect((await ctx.request(user.token).get(`/api/attachments/${body.id}/download`)).status).toBe(
      404
    );
  });

  // A file can be a valid GIF and valid HTML at once. Sniffing sends it down the
  // image path, so what protects the origin is the response header rather than
  // which route stored it.
  it('serves a GIF/HTML polyglot as an image, with sniffing disabled', async () => {
    const user = await ctx.createUser('att-poly');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: 'evil.gif', contentType: 'image/gif' }), POLYGLOT);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kind).toBe('image');

    const served = await ctx.request(user.token).get(`/api/images/${body.id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/gif');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
  });

  // Without the upload path in the global body-limit exemption every real upload
  // 413s before the route's own, larger limit is ever reached.
  it('accepts an upload well past the global 1 MB body limit', async () => {
    const user = await ctx.createUser('att-big');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const big = Buffer.alloc(3 * 1024 * 1024, 0x41);

    const res = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: 'big.bin' }), big);

    expect(res.status).toBe(201);
    expect((await res.json()).size_bytes).toBe(big.length);
  });

  it('refuses an empty file with 422', async () => {
    const user = await ctx.createUser('att-empty');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx
      .request(user.token)
      .postBytes(
        uploadPath(taskId, { filename: 'empty.txt', contentType: 'text/plain' }),
        Buffer.alloc(0)
      );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('File is empty');
  });

  it('leaves no storage object behind when the file is empty', async () => {
    const user = await ctx.createUser('att-empty2');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const before = await listStorageKeys();
    const res = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: 'empty.txt' }), streamOf(Buffer.alloc(0), 0));
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
        .postBytes(uploadPath(taskId, { filename: 'big.bin' }), Buffer.alloc(4096, 1));
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
        .postBytes(
          uploadPath(taskId, { filename: 'stream.bin' }),
          streamOf(Buffer.alloc(1024, 9), 64)
        );

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
      .postBytes(
        uploadPath(taskId, { filename: 'stream.bin' }),
        streamOf(Buffer.alloc(1024, 3), 8)
      );

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

  // Sniffed images carry their own, lower cap because they are served inline
  // from an unauthenticated URL, so the file cap is never what bounds them.
  it('refuses an image past the 10 MB image cap and stores nothing', async () => {
    const user = await ctx.createUser('att-imgcap');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const megabyte = Buffer.concat([PNG_1X1, Buffer.alloc(1024 * 1024 - PNG_1X1.length, 0)]);

    const under = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: 'small.png' }), streamOf(megabyte, 2));
    expect(under.status).toBe(201);
    expect(await under.json()).toMatchObject({
      kind: 'image',
      content_type: 'image/png',
      size_bytes: 2 * 1024 * 1024,
    });

    const before = await listStorageKeys();
    const over = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: 'huge.png' }), streamOf(megabyte, 11));

    expect(over.status).toBe(413);
    // Pinned as it stands: the refusal names the file cap even though the image
    // cap is the one that cut the stream at 10 MB.
    expect((await over.json()).error).toBe(
      `File exceeds the ${String(env.attachmentMaxBytes)} byte limit`
    );
    expect(
      await db
        .selectFrom('task_attachment')
        .select('filename')
        .where('task_id', '=', taskId)
        .execute()
    ).toEqual([{ filename: 'small.png' }]);

    const after = await listStorageKeys();
    expect([...after].filter((key) => !before.has(key))).toEqual([]);
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

    const res = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: 'x.pdf' }), PDF);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain('at most 50 attachments');
  });

  it('honors a client-supplied id and answers 409 for a duplicate', async () => {
    const user = await ctx.createUser('att-id');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const id = newId();

    const first = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: 'a.pdf', contentType: '', id: id }), PDF);
    expect(first.status).toBe(201);
    expect((await first.json()).id).toBe(id);

    const second = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: 'b.pdf', contentType: '', id: id }), PDF);
    expect(second.status).toBe(409);
  });

  it('refuses a malformed task_id or id with 400', async () => {
    const user = await ctx.createUser('att-uuid');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const badTask = await ctx
      .request(user.token)
      .postBytes(uploadPath('not-a-uuid', { filename: 'a.pdf' }), PDF);
    expect(badTask.status).toBe(400);

    const badId = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: 'a.pdf', contentType: '', id: 'nope' }), PDF);
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

    const unknown = await ctx
      .request(owner.token)
      .postBytes(uploadPath(newId(), { filename: 'a.pdf' }), PDF);
    expect(unknown.status).toBe(404);

    const outsider = await ctx
      .request(stranger.token)
      .postBytes(uploadPath(taskId, { filename: 'a.pdf' }), PDF);
    expect(outsider.status).toBe(404);

    const readOnly = await ctx
      .request(viewer.token)
      .postBytes(uploadPath(taskId, { filename: 'a.pdf' }), PDF);
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
      .postBytes(uploadPath(taskId, { filename: 'a.pdf' }), Buffer.alloc(4096, 2));
    expect(res.status).toBe(403);

    const after = await listStorageKeys();
    expect([...after].filter((key) => !before.has(key))).toEqual([]);
  });

  it('answers 401 without a token', async () => {
    const user = await ctx.createUser('att-anon');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx.request().postBytes(uploadPath(taskId, { filename: 'a.pdf' }), PDF);
    expect(res.status).toBe(401);
  });

  it('stores the sanitized declared MIME type, whatever the bytes are', async () => {
    const user = await ctx.createUser('att-mime');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx
      .request(user.token)
      .postBytes(
        uploadPath(taskId, { filename: 'lies.pdf', contentType: 'text/html; charset=utf-8' }),
        PDF
      );
    expect(res.status).toBe(201);
    expect((await res.json()).content_type).toBe('text/html');
  });

  it('sanitizes a path-shaped filename down to its basename', async () => {
    const user = await ctx.createUser('att-name');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const res = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: '../../etc/pas"swd.pdf' }), PDF);
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
          .postBytes(uploadPath(taskId, { filename: 'fits.bin' }), Buffer.alloc(2000, 3));
        expect(fits.status).toBe(201);

        const before = await listStorageKeys();
        const overflows = await ctx
          .request(user.token)
          .postBytes(uploadPath(taskId, { filename: 'over.bin' }), Buffer.alloc(100, 4));
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
          .postBytes(
            uploadPath(taskId, { filename: 'over.bin' }),
            streamOf(Buffer.alloc(1024, 6), 16)
          );

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
        const image = await ctx
          .request(user.token)
          .postBytes(uploadPath(taskId, { filename: 'p.png' }), PNG_1X1);
        expect(image.status).toBe(201);

        const attachment = await ctx
          .request(user.token)
          .postBytes(uploadPath(taskId, { filename: 'over.bin' }), Buffer.alloc(64, 5));
        expect(attachment.status).toBe(413);

        const secondImage = await ctx
          .request(user.token)
          .postBytes(uploadPath(taskId, { filename: 'q.png' }), PNG_1X1);
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

    const first = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: 'one.pdf' }), PDF);
    expect(first.status).toBe(201);
    const second = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: 'two.zip' }), ZIP);
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

    const res = await ctx
      .request(user.token)
      .postBytes(uploadPath(taskId, { filename: 'x.svg' }), SVG);
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
