import http from 'node:http';
import { describe, it, expect, afterAll, beforeAll, afterEach } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { db } from '../../../src/db/index';
import { subscribeBus, type BusEntry } from '../../../src/services/realtime/bus';
import { runAttachmentUnfurl } from '../../../src/services/attachments/unfurl';
import {
  cleanupProjects,
  clearUnfurlJobs,
  createTaskFixture,
  listStorageKeys,
  storedKeyExists,
} from './helpers';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('Link unfurl', () => {
  const ctx = new TestContext();
  const createdProjectIds: string[] = [];

  let server: http.Server;
  let port: number;
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  const origin = (): string => `http://127.0.0.1:${String(port)}`;

  const pageWith = (head: string) => (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><head>${head}</head><body>hi</body></html>`);
      return;
    }
    if (req.url === '/preview.png' || req.url === '/icon.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(PNG_1X1);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('missing');
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => handler(req, res));
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(() => {
    handler = pageWith('');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await clearUnfurlJobs();
    await cleanupProjects(createdProjectIds);
    await ctx.cleanup();
  });

  async function makeLink(
    ownerId: string,
    url: string,
    overrides: Record<string, unknown> = {}
  ): Promise<{ id: string; taskId: string; projectId: string }> {
    const { taskId, projectId } = await createTaskFixture(ownerId, createdProjectIds);
    const id = newId();
    await db
      .insertInto('task_attachment')
      .values({ id, task_id: taskId, kind: 'link', url, unfurl_state: 'pending', ...overrides })
      .execute();
    return { id, taskId, projectId };
  }

  async function rowOf(id: string) {
    return await db
      .selectFrom('task_attachment')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }

  it('stores title, description, preview and favicon and settles at ok', async () => {
    const user = await ctx.createUser('unfurl-ok');
    handler = pageWith(
      '<title>Ignored</title>' +
        '<meta property="og:title" content="The Spec">' +
        '<meta property="og:description" content="What we are building">' +
        '<meta property="og:image" content="/preview.png">' +
        '<link rel="icon" href="/icon.png">'
    );
    const { id, projectId } = await makeLink(user.id, `${origin()}/`);

    const seen: BusEntry[] = [];
    const unsubscribe = subscribeBus((entry) => seen.push(entry));
    try {
      await runAttachmentUnfurl(id);
    } finally {
      unsubscribe();
    }

    const row = await rowOf(id);
    expect(row.unfurl_state).toBe('ok');
    expect(row.title).toBe('The Spec');
    expect(row.description).toBe('What we are building');
    expect(row.preview_storage_key).not.toBeNull();
    expect(row.favicon_storage_key).not.toBeNull();

    const published = seen.filter((entry) => entry.type === 'attachment_updated');
    expect(published).toHaveLength(1);
    expect(published[0].project_id).toBe(projectId);
    expect(published[0].data).toMatchObject({
      id,
      unfurl_state: 'ok',
      preview_url: `/api/attachments/${id}/preview`,
      favicon_url: `/api/attachments/${id}/favicon`,
    });

    const preview = await ctx.request(user.token).get(`/api/attachments/${id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('Content-Type')).toBe('image/webp');
    expect(preview.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    const previewBytes = Buffer.from(await preview.arrayBuffer());
    expect(previewBytes.length).toBeGreaterThan(0);
    expect(preview.headers.get('Content-Length')).toBe(String(previewBytes.length));

    const favicon = await ctx.request(user.token).get(`/api/attachments/${id}/favicon`);
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get('Content-Type')).toBe('image/webp');
    const faviconBytes = Buffer.from(await favicon.arrayBuffer());
    expect(faviconBytes.length).toBeGreaterThan(0);
    expect(favicon.headers.get('Content-Length')).toBe(String(faviconBytes.length));
  });

  it.each([
    [
      'a 403',
      (_req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(403, { 'Content-Type': 'text/html' });
        res.end('nope');
      },
    ],
    [
      'a 500',
      (_req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('boom');
      },
    ],
    [
      'a text/plain body',
      (_req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('just text');
      },
    ],
    [
      'an oversized body',
      (_req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('x'.repeat(1024 * 1024));
      },
    ],
  ])('settles at failed without throwing for %s', async (_label, respond) => {
    const user = await ctx.createUser('unfurl-fail');
    handler = respond;
    const url = `${origin()}/`;
    const { id } = await makeLink(user.id, url);

    await expect(runAttachmentUnfurl(id)).resolves.toBeUndefined();

    const row = await rowOf(id);
    expect(row.unfurl_state).toBe('failed');
    expect(row.url).toBe(url);
    expect(row.title).toBeNull();
    expect(row.preview_storage_key).toBeNull();
  });

  it('settles at failed for an address the policy would refuse in production', async () => {
    const previous = process.env.ENVIRONMENT;
    process.env.ENVIRONMENT = 'production';
    try {
      const user = await ctx.createUser('unfurl-ssrf');
      const { id } = await makeLink(user.id, 'http://169.254.169.254/latest/meta-data/');

      await expect(runAttachmentUnfurl(id)).resolves.toBeUndefined();
      expect((await rowOf(id)).unfurl_state).toBe('failed');
    } finally {
      if (previous === undefined) delete process.env.ENVIRONMENT;
      else process.env.ENVIRONMENT = previous;
    }
  });

  it('keeps the text metadata when the preview image does not sniff as an image', async () => {
    const user = await ctx.createUser('unfurl-badimg');
    handler = (req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<html><head><meta property="og:title" content="Titled">' +
            '<meta property="og:image" content="/fake.png"></head></html>'
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end('<html>not really a png</html>');
    };
    const { id } = await makeLink(user.id, `${origin()}/`);

    await runAttachmentUnfurl(id);

    const row = await rowOf(id);
    expect(row.unfurl_state).toBe('ok');
    expect(row.title).toBe('Titled');
    expect(row.preview_storage_key).toBeNull();
  });

  it('discards an over-large preview image and still settles at ok', async () => {
    const user = await ctx.createUser('unfurl-bigimg');
    handler = (req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<html><head><meta property="og:title" content="Big">' +
            '<meta property="og:image" content="/huge.png"></head></html>'
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.concat([PNG_1X1, Buffer.alloc(3 * 1024 * 1024, 0)]));
    };
    const { id } = await makeLink(user.id, `${origin()}/`);

    await runAttachmentUnfurl(id);

    const row = await rowOf(id);
    expect(row.unfurl_state).toBe('ok');
    expect(row.title).toBe('Big');
    expect(row.preview_storage_key).toBeNull();
  });

  it('lets exactly one of two concurrent runs win and reclaims the loser objects', async () => {
    const user = await ctx.createUser('unfurl-race');
    handler = pageWith(
      '<meta property="og:title" content="Raced">' +
        '<meta property="og:image" content="/preview.png">' +
        '<link rel="icon" href="/icon.png">'
    );
    const { id } = await makeLink(user.id, `${origin()}/`);

    const before = await listStorageKeys();
    const seen: BusEntry[] = [];
    const unsubscribe = subscribeBus((entry) => seen.push(entry));
    try {
      await Promise.all([runAttachmentUnfurl(id), runAttachmentUnfurl(id)]);
    } finally {
      unsubscribe();
    }

    const row = await rowOf(id);
    expect(row.unfurl_state).toBe('ok');
    expect(seen.filter((entry) => entry.type === 'attachment_updated')).toHaveLength(1);

    const after = await listStorageKeys();
    const added = [...after].filter((key) => !before.has(key));
    expect(added.sort()).toEqual(
      [row.preview_storage_key, row.favicon_storage_key].filter(Boolean).sort()
    );
  });

  it('resolves and leaves no orphan when the row vanishes mid-flight', async () => {
    const user = await ctx.createUser('unfurl-gone');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    handler = (req, res) => {
      if (req.url === '/') {
        void gate.then(() => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(
            '<html><head><meta property="og:title" content="Doomed">' +
              '<meta property="og:image" content="/preview.png"></head></html>'
          );
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(PNG_1X1);
    };
    const { id } = await makeLink(user.id, `${origin()}/`);

    const before = await listStorageKeys();
    const running = runAttachmentUnfurl(id);
    await db.deleteFrom('task_attachment').where('id', '=', id).execute();
    release();

    await expect(running).resolves.toBeUndefined();

    const after = await listStorageKeys();
    expect([...after].filter((key) => !before.has(key))).toEqual([]);
  });

  it('keeps a title the user typed while the job was in flight', async () => {
    const user = await ctx.createUser('unfurl-typed');
    handler = pageWith(
      '<meta property="og:title" content="Fetched"><meta property="og:description" content="Fetched desc">'
    );
    const { id } = await makeLink(user.id, `${origin()}/`, { title: 'Mine' });

    await runAttachmentUnfurl(id);

    const row = await rowOf(id);
    expect(row.title).toBe('Mine');
    expect(row.description).toBe('Fetched desc');
    expect(row.unfurl_state).toBe('ok');
  });

  it.each(['ok', 'failed'])('leaves a row already %s untouched', async (state) => {
    const user = await ctx.createUser('unfurl-settled');
    handler = pageWith('<meta property="og:title" content="New">');
    const { id } = await makeLink(user.id, `${origin()}/`, {
      unfurl_state: state,
      title: 'Original',
    });

    await runAttachmentUnfurl(id);

    const row = await rowOf(id);
    expect(row.unfurl_state).toBe(state);
    expect(row.title).toBe('Original');
  });

  it('does nothing for an id that is not a link', async () => {
    const user = await ctx.createUser('unfurl-file');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const id = newId();
    const storageKey = newId();
    await db
      .insertInto('task_attachment')
      .values({
        id,
        task_id: taskId,
        kind: 'file',
        filename: 'a.pdf',
        content_type: 'application/pdf',
        size_bytes: 3,
        storage_key: storageKey,
      })
      .execute();

    await expect(runAttachmentUnfurl(id)).resolves.toBeUndefined();
    expect(await storedKeyExists(storageKey)).toBe(false);
    expect((await rowOf(id)).unfurl_state).toBeNull();
  });

  it('does nothing for an id that no longer exists', async () => {
    await expect(runAttachmentUnfurl(newId())).resolves.toBeUndefined();
  });
});
