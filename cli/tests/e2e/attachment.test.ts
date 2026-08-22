import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TestContext, type TestUser } from '../../../api/tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type Attachment = components['schemas']['Attachment'];

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5CYII=',
  'base64'
);
const PDF = Buffer.from('%PDF-1.4\nbody\n%%EOF\n');

describe('attachment commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let dir: string;
  let pngPath: string;
  let pdfPath: string;
  let projectId: string;
  let taskId: string;
  let fileId: string;
  let imageId: string;

  beforeAll(async () => {
    user = await tc.createUser('cli-att');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });

    dir = await mkdtemp(join(tmpdir(), 'cpath-att-'));
    pngPath = join(dir, 'pixel.png');
    pdfPath = join(dir, 'spec.pdf');
    await writeFile(pngPath, PNG_1X1);
    await writeFile(pdfPath, PDF);

    const client = tc.request(user.token);
    projectId = crypto.randomUUID();
    const project = await client.post('/api/projects', {
      id: projectId,
      name: 'CLI Attachment Fixture',
    });
    expect(project.status).toBe(201);
    const board = (await project.json()) as components['schemas']['BoardResponse'];
    taskId = crypto.randomUUID();
    const task = await client.post('/api/tasks', {
      id: taskId,
      project_id: projectId,
      column_id: board.columns[0].id,
      title: 'Task with attachments',
      position: 1000,
    });
    expect(task.status).toBe(201);
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  it('uploads a document as a file', async () => {
    const res = await h.runCli(['attachment', 'upload', taskId, pdfPath, '--json']);
    expect(res.exitCode).toBe(0);
    const uploaded = res.json<Attachment>();
    expect(uploaded.kind).toBe('file');
    expect(uploaded.filename).toBe('spec.pdf');
    fileId = uploaded.id;
  });

  // The CLI sends every upload the same way and declares nothing about the
  // bytes; the server reads them and answers with what they turned out to be.
  it('uploads a picture as an image without being told it is one', async () => {
    const res = await h.runCli(['attachment', 'upload', taskId, pngPath, '--json']);
    expect(res.exitCode).toBe(0);
    const uploaded = res.json<Attachment>();
    expect(uploaded.kind).toBe('image');
    expect(uploaded.content_type).toBe('image/png');
    expect(uploaded.image_url).toBe(`/api/images/${uploaded.id}`);
    imageId = uploaded.id;
  });

  it('attaches a link, which starts out unfurled', async () => {
    const res = await h.runCli([
      'attachment',
      'link',
      'Task with attachments',
      'https://example.com/doc',
      '--project',
      'CLI Attachment Fixture',
      '--title',
      'Design doc',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    const created = res.json<Attachment>();
    expect(created.kind).toBe('link');
    expect(created.title).toBe('Design doc');
    expect(created.unfurl_state).toBe('pending');
  });

  it('lists all three kinds in one table, and filters by kind', async () => {
    const all = await h.runCli(['attachment', 'list', taskId, '--json']);
    expect(all.exitCode).toBe(0);
    expect(
      all
        .json<Attachment[]>()
        .map((a) => a.kind)
        .sort()
    ).toEqual(['file', 'image', 'link']);

    const images = await h.runCli(['attachment', 'list', taskId, '--kind', 'image', '--json']);
    expect(images.json<Attachment[]>().map((a) => a.id)).toEqual([imageId]);
  });

  it('downloads a file and an image, which are served by different routes', async () => {
    const filePath = join(dir, 'out.pdf');
    const file = await h.runCli(['attachment', 'download', fileId, '-o', filePath, '--json']);
    expect(file.exitCode).toBe(0);
    expect(await readFile(filePath)).toEqual(PDF);

    const imagePath = join(dir, 'out.png');
    const image = await h.runCli(['attachment', 'download', imageId, '-o', imagePath, '--json']);
    expect(image.exitCode).toBe(0);
    expect(await readFile(imagePath)).toEqual(PNG_1X1);
  });

  it('renames an attachment without touching its filename', async () => {
    const res = await h.runCli(['attachment', 'rename', fileId, 'The specification', '--json']);
    expect(res.exitCode).toBe(0);
    const updated = res.json<Attachment>();
    expect(updated.title).toBe('The specification');
    expect(updated.filename).toBe('spec.pdf');
  });

  it('deletes an attachment once confirmed', async () => {
    const res = await h.runCli(['attachment', 'delete', fileId, '--force', '--json']);
    expect(res.exitCode).toBe(0);

    const listed = await h.runCli(['attachment', 'list', taskId, '--json']);
    expect(listed.json<Attachment[]>().map((a) => a.id)).not.toContain(fileId);
  });

  it('answers the short alias too', async () => {
    const res = await h.runCli(['att', 'list', taskId, '--json']);
    expect(res.exitCode).toBe(0);
  });
});
