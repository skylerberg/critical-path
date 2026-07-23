import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type ImageResponse = components['schemas']['ImageResponse'];

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5CYII=',
  'base64'
);

describe('image commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let dir: string;
  let pngPath: string;
  let projectId: string;
  let taskId: string;
  let imageId: string;

  beforeAll(async () => {
    user = await tc.createUser('cli-image');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });

    dir = await mkdtemp(join(tmpdir(), 'cpath-image-'));
    pngPath = join(dir, 'pixel.png');
    await writeFile(pngPath, PNG_1X1);

    const client = tc.request(user.token);
    projectId = crypto.randomUUID();
    const project = await client.post('/api/projects', {
      id: projectId,
      name: 'CLI Image Fixture',
    });
    expect(project.status).toBe(201);
    const board = (await project.json()) as components['schemas']['BoardPayload'];
    taskId = crypto.randomUUID();
    const task = await client.post('/api/tasks', {
      id: taskId,
      project_id: projectId,
      column_id: board.columns[0].id,
      title: 'Task with image',
      position: 1000,
    });
    expect(task.status).toBe(201);
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  it('uploads an image to a task', async () => {
    const res = await h.runCli(['image', 'upload', taskId, pngPath, '--json']);
    expect(res.exitCode).toBe(0);
    const uploaded = res.json<ImageResponse>();
    expect(uploaded.filename).toBe('pixel.png');
    expect(uploaded.content_type).toBe('image/png');
    imageId = uploaded.id;
  });

  it('lists images by task title reference', async () => {
    const res = await h.runCli([
      'image',
      'list',
      'Task with image',
      '--project',
      projectId,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<ImageResponse[]>().map((i) => i.id)).toContain(imageId);
  });

  it('downloads the exact bytes back', async () => {
    const out = join(dir, 'downloaded.png');
    const res = await h.runCli(['image', 'download', imageId, '-o', out]);
    expect(res.exitCode).toBe(0);
    expect(await readFile(out)).toEqual(PNG_1X1);
  });

  it('rejects a non-image upload with exit 6', async () => {
    const textPath = join(dir, 'notes.txt');
    await writeFile(textPath, 'not an image');
    const res = await h.runCli(['image', 'upload', taskId, textPath]);
    expect(res.exitCode).toBe(6);
  });

  it('deletes the image', async () => {
    const res = await h.runCli(['image', 'delete', imageId, '--force']);
    expect(res.exitCode).toBe(0);
    const list = await h.runCli(['image', 'list', taskId, '--json']);
    expect(list.json<ImageResponse[]>()).toEqual([]);
    const download = await h.runCli(['image', 'download', imageId, '-o', join(dir, 'gone.png')]);
    expect(download.exitCode).toBe(4);
  });
});
