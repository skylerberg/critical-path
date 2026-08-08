import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { TestContext, type TestUser, type TestResponse } from '../../setup/testContext';
import { storage } from '../../../src/services/storage/index';
import { cleanupProjects, createTaskFixture, uploadPath } from './helpers';

// The rest of the suite drives app.request(), which never writes a byte to a
// socket. Only a live one can show what a reader actually receives once the
// status is already committed.
describe('attachment downloads over a real socket', () => {
  const ctx = new TestContext();
  const createdProjectIds: string[] = [];
  let server: ServerType;
  let port: number;
  let user: TestUser;
  let taskId: string;

  beforeAll(async () => {
    server = serve({ fetch: app.fetch, port: 0 });
    port = (server.address() as { port: number }).port;
    user = await ctx.createUser('att-download-socket');
    ({ taskId } = await createTaskFixture(user.id, createdProjectIds));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupProjects(createdProjectIds);
    await ctx.cleanup();
  });

  function url(path: string): string {
    return `http://127.0.0.1:${String(port)}${path}`;
  }

  function authed(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(url(path), {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${user.token}` },
    });
  }

  async function upload(bytes: Buffer, filename: string): Promise<string> {
    const res = (await fetch(
      url(uploadPath(taskId, { filename: filename, contentType: 'application/octet-stream' })),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${user.token}`,
          'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array(bytes),
      }
    )) as TestResponse;
    expect(res.status).toBe(201);
    return (await res.json()).id;
  }

  it('serves 8 MB with a Content-Length and the bytes intact', async () => {
    const bytes = Buffer.alloc(8 * 1024 * 1024, 0x41);
    const id = await upload(bytes, 'big.bin');

    const res = await authed(`/api/attachments/${id}/download`);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe(String(bytes.length));
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('sends the headers before the last byte has been read from storage', async () => {
    const id = await upload(Buffer.from('placeholder'), 'slow.bin');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sent = 0;
    const source = new Readable({
      read() {
        sent += 1;
        if (sent === 1) {
          this.push(Buffer.from('first '));
          return;
        }
        void gate.then(() => {
          this.push(Buffer.from('second'));
          this.push(null);
        });
      },
    });
    vi.spyOn(storage, 'getStream').mockResolvedValue({ stream: source, size: 12 });

    const res = await authed(`/api/attachments/${id}/download`);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe('12');
    expect(source.readableEnded).toBe(false);

    release();
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('first second');
  });

  it('truncates the connection when storage fails mid-stream, appending no error body', async () => {
    const id = await upload(Buffer.from('placeholder'), 'doomed.bin');
    let breakIt!: () => void;
    const broken = new Promise<void>((resolve) => {
      breakIt = resolve;
    });
    let sent = 0;
    const source = new Readable({
      read() {
        sent += 1;
        if (sent === 1) {
          this.push(Buffer.from('half'));
          return;
        }
        void broken.then(() => this.destroy(new Error('storage went away mid-stream')));
      },
    });
    vi.spyOn(storage, 'getStream').mockResolvedValue({ stream: source, size: 4096 });

    const res = await authed(`/api/attachments/${id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe('4096');

    const reader = res.body!.getReader();
    expect(Buffer.from((await reader.read()).value!).toString()).toBe('half');

    breakIt();
    const rest: Buffer[] = [];
    let failed = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) rest.push(Buffer.from(value));
      }
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
    expect(Buffer.concat(rest).length).toBe(0);
  });

  it('destroys the storage stream when the client disconnects mid-download', async () => {
    const id = await upload(Buffer.from('placeholder'), 'abandoned.bin');
    const chunk = Buffer.alloc(64 * 1024, 0x43);
    let remaining = 512;
    const source = new Readable({
      read() {
        this.push(remaining-- > 0 ? chunk : null);
      },
    });
    vi.spyOn(storage, 'getStream').mockResolvedValue({ stream: source, size: 512 * chunk.length });

    const controller = new AbortController();
    const res = await authed(`/api/attachments/${id}/download`, { signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();

    await expect.poll(() => source.destroyed, { timeout: 5000 }).toBe(true);
    expect(remaining).toBeGreaterThan(0);
  });
});
