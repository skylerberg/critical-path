import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { TestContext, type TestUser, type TestResponse } from '../../setup/testContext';
import { db } from '../../../src/db/index';
import { cleanupProjects, createTaskFixture, listStorageKeys, uploadPath } from './helpers';

// The rest of the suite drives app.request() and its undici body. Only a live
// socket exercises the adapter production actually uses, which is where a body
// would be assembled before the handler ever ran.
describe('upload over a real socket', () => {
  const ctx = new TestContext();
  const createdProjectIds: string[] = [];
  let server: ServerType;
  let port: number;
  let user: TestUser;
  let taskId: string;

  beforeAll(async () => {
    server = serve({ fetch: app.fetch, port: 0 });
    port = (server.address() as { port: number }).port;
    user = await ctx.createUser('att-socket');
    ({ taskId } = await createTaskFixture(user.id, createdProjectIds));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupProjects(createdProjectIds);
    await ctx.cleanup();
  });

  function chunked(chunk: Buffer, times: number): ReadableStream<Uint8Array> {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= times) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(new Uint8Array(chunk));
      },
    });
  }

  async function upload(
    path: string,
    body: NonNullable<RequestInit['body']>
  ): Promise<TestResponse> {
    return (await fetch(`http://127.0.0.1:${String(port)}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${user.token}`,
        'Content-Type': 'application/octet-stream',
      },
      body,
      duplex: 'half',
    } as RequestInit)) as TestResponse;
  }

  it('stores 8 MB sent as chunks with no declared length', async () => {
    const res = await upload(
      uploadPath(taskId, 'big.bin'),
      chunked(Buffer.alloc(1024 * 1024, 0x41), 8)
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.size_bytes).toBe(8 * 1024 * 1024);

    const row = await db
      .selectFrom('task_attachment')
      .select('size_bytes')
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow();
    expect(row.size_bytes).toBe(8 * 1024 * 1024);
  });

  it('cuts an oversized chunked upload off and keeps no object', async () => {
    const previous = process.env.ATTACHMENT_MAX_BYTES;
    process.env.ATTACHMENT_MAX_BYTES = String(1024 * 1024);
    try {
      const before = await listStorageKeys();
      const res = await upload(
        uploadPath(taskId, 'toobig.bin'),
        chunked(Buffer.alloc(256 * 1024, 0x42), 64)
      );

      expect(res.status).toBe(413);
      const after = await listStorageKeys();
      expect([...after].filter((key) => !before.has(key))).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.ATTACHMENT_MAX_BYTES;
      else process.env.ATTACHMENT_MAX_BYTES = previous;
    }
  });
});
