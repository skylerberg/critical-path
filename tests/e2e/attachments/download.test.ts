import { promises as fs } from 'fs';
import { describe, it, expect, afterAll, vi } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { db } from '../../../src/db/index';
import { logger } from '../../../src/utils/logger';
import { cleanupProjects, createTaskFixture, storagePath, uploadPath } from './helpers';

const PDF = Buffer.from('%PDF-1.4\ncontent\n%%EOF\n');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<html><script>alert(1)</script></html>');
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('GET /api/attachments/:id/download', () => {
  const ctx = new TestContext();
  const createdProjectIds: string[] = [];

  afterAll(async () => {
    await cleanupProjects(createdProjectIds);
    await ctx.cleanup();
  });

  async function upload(
    token: string,
    taskId: string,
    bytes: Buffer,
    filename: string,
    mimeType: string
  ): Promise<string> {
    const res = await ctx.request(token).postBytes(uploadPath(taskId, filename, mimeType), bytes);
    expect(res.status).toBe(201);
    return (await res.json()).id;
  }

  it.each([
    ['a PDF', PDF, 'spec.pdf', 'application/pdf'],
    ['an SVG', SVG, 'evil.svg', 'image/svg+xml'],
    ['an HTML file', HTML, 'evil.html', 'text/html'],
    ['a PNG', PNG_1X1, 'pixel.png', 'image/png'],
  ])(
    'serves %s as an opaque download, never as its declared type',
    async (_label, bytes, filename, mimeType) => {
      const user = await ctx.createUser('dl-type');
      const { taskId } = await createTaskFixture(user.id, createdProjectIds);
      const id = await upload(user.token, taskId, bytes, filename, mimeType);

      const res = await ctx.request(user.token).get(`/api/attachments/${id}/download`);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
      const disposition = res.headers.get('Content-Disposition') ?? '';
      expect(disposition.startsWith('attachment;')).toBe(true);
      expect(disposition).toContain(`filename="${filename}"`);
      expect(disposition).toContain("filename*=UTF-8''");
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
      expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    }
  );

  it('answers 401 without a token', async () => {
    const user = await ctx.createUser('dl-anon');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const id = await upload(user.token, taskId, PDF, 'a.pdf', 'application/pdf');

    expect((await ctx.request().get(`/api/attachments/${id}/download`)).status).toBe(401);
  });

  it('answers 404 to a non-member and 200 to a viewer', async () => {
    const owner = await ctx.createUser('dl-owner');
    const stranger = await ctx.createUser('dl-stranger');
    const viewer = await ctx.createUser('dl-viewer');
    const { projectId, taskId } = await createTaskFixture(owner.id, createdProjectIds);
    await db
      .insertInto('project_member')
      .values({ project_id: projectId, user_id: viewer.id, role: 'viewer' })
      .execute();
    const id = await upload(owner.token, taskId, PDF, 'a.pdf', 'application/pdf');

    expect((await ctx.request(stranger.token).get(`/api/attachments/${id}/download`)).status).toBe(
      404
    );
    expect((await ctx.request(viewer.token).get(`/api/attachments/${id}/download`)).status).toBe(
      200
    );
  });

  // The whole reason this route is authenticated rather than a capability URL.
  it('stops serving to a member the moment they are removed from the project', async () => {
    const owner = await ctx.createUser('dl-owner2');
    const member = await ctx.createUser('dl-member');
    const { projectId, taskId } = await createTaskFixture(owner.id, createdProjectIds);
    await db
      .insertInto('project_member')
      .values({ project_id: projectId, user_id: member.id, role: 'editor' })
      .execute();
    const id = await upload(owner.token, taskId, PDF, 'contract.pdf', 'application/pdf');

    expect((await ctx.request(member.token).get(`/api/attachments/${id}/download`)).status).toBe(
      200
    );

    await db
      .deleteFrom('project_member')
      .where('project_id', '=', projectId)
      .where('user_id', '=', member.id)
      .execute();

    expect((await ctx.request(member.token).get(`/api/attachments/${id}/download`)).status).toBe(
      404
    );
  });

  it('answers 404 for a link attachment', async () => {
    const user = await ctx.createUser('dl-link');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const id = newId();
    await db
      .insertInto('task_attachment')
      .values({
        id,
        task_id: taskId,
        kind: 'link',
        url: 'https://example.com/',
        unfurl_state: 'ok',
      })
      .execute();

    expect((await ctx.request(user.token).get(`/api/attachments/${id}/download`)).status).toBe(404);
  });

  it('answers 404 and logs when the storage object has gone missing', async () => {
    const user = await ctx.createUser('dl-missing');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const id = await upload(user.token, taskId, PDF, 'gone.pdf', 'application/pdf');

    const row = await db
      .selectFrom('task_attachment')
      .select('storage_key')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    await fs.rm(storagePath(row.storage_key as string), { force: true });

    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      expect((await ctx.request(user.token).get(`/api/attachments/${id}/download`)).status).toBe(
        404
      );
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('answers 404 for an unknown id', async () => {
    const user = await ctx.createUser('dl-unknown');
    expect((await ctx.request(user.token).get(`/api/attachments/${newId()}/download`)).status).toBe(
      404
    );
  });

  // The preview route never selects storage_key, so a file's id cannot make it
  // serve the file's bytes no matter who guesses it.
  it('cannot be reached through the unauthenticated preview or favicon routes', async () => {
    const user = await ctx.createUser('dl-preview');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const id = await upload(user.token, taskId, HTML, 'evil.html', 'text/html');

    expect((await ctx.request().get(`/api/attachments/${id}/preview`)).status).toBe(404);
    expect((await ctx.request().get(`/api/attachments/${id}/favicon`)).status).toBe(404);
    expect((await ctx.request(user.token).get(`/api/attachments/${id}/preview`)).status).toBe(404);
  });

  it('escapes a hostile filename into a legal Content-Disposition', async () => {
    const user = await ctx.createUser('dl-name');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);
    const id = await upload(user.token, taskId, PDF, 'répertoire "final".pdf', 'application/pdf');

    const res = await ctx.request(user.token).get(`/api/attachments/${id}/download`);
    const disposition = res.headers.get('Content-Disposition') ?? '';

    expect(res.status).toBe(200);
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).toContain('filename="r_pertoire final.pdf"');
    expect(decodeURIComponent(/filename\*=UTF-8''(.*)$/.exec(disposition)?.[1] ?? '')).toBe(
      'répertoire final.pdf'
    );
  });
});
