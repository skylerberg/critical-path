import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import { markdownToTiptap } from '../../src/markdown';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardPayload'];
type BoardTask = components['schemas']['BoardTask'];
type TaskDetailResponse = components['schemas']['TaskDetailResponse'];

describe('task descriptions', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let projectId: string;
  let tempDir: string;
  let markdownTaskId: string;

  async function fetchDescription(taskId: string): Promise<unknown> {
    const res = await tc.request(user.token).get(`/api/tasks/${taskId}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as TaskDetailResponse).description;
  }

  beforeAll(async () => {
    user = await tc.createUser('cli-desc');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const create = await tc.request(user.token).post('/api/projects', {
      id: crypto.randomUUID(),
      name: 'CLI Descriptions Fixture',
    });
    expect(create.status).toBe(201);
    projectId = ((await create.json()) as BoardPayload).project.id;
    tempDir = await mkdtemp(join(tmpdir(), 'cpath-desc-'));
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await rm(tempDir, { recursive: true, force: true });
    await tc.cleanup();
  });

  it('create --description stores exactly markdownToTiptap(md)', async () => {
    const md = '# Release notes\n\nShip the **beta** with *care*.\n\n- item one\n- item two';
    const res = await h.runCli([
      'task',
      'create',
      'Markdown described',
      '--project',
      projectId,
      '--description',
      md,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    markdownTaskId = res.json<BoardTask>().id;
    expect(await fetchDescription(markdownTaskId)).toEqual(markdownToTiptap(md));
  });

  it('show renders the description back as Markdown', async () => {
    const res = await h.runCli(['task', 'show', markdownTaskId]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('# Release notes');
    expect(res.stdout).toContain('**beta**');
    expect(res.stdout).toContain('- item one');
  });

  it('create --description-file reads Markdown from a file', async () => {
    const md = '## From a file\n\nA `code` span and a [link](https://example.com).';
    const path = join(tempDir, 'description.md');
    await writeFile(path, md);
    const res = await h.runCli([
      'task',
      'create',
      'File described',
      '--project',
      projectId,
      '--description-file',
      path,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(await fetchDescription(res.json<BoardTask>().id)).toEqual(markdownToTiptap(md));
  });

  it('create --description-json takes a literal Tiptap doc from a file', async () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Literal doc from a file' }] },
      ],
    };
    const path = join(tempDir, 'description.json');
    await writeFile(path, JSON.stringify(doc));
    const res = await h.runCli([
      'task',
      'create',
      'JSON described',
      '--project',
      projectId,
      '--description-json',
      path,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(await fetchDescription(res.json<BoardTask>().id)).toEqual(doc);
  });

  it('create --description-json - reads the doc from stdin', async () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Doc from stdin' }] }],
    };
    const res = await h.runCli(
      [
        'task',
        'create',
        'Stdin described',
        '--project',
        projectId,
        '--description-json',
        '-',
        '--json',
      ],
      { stdin: JSON.stringify(doc) }
    );
    expect(res.exitCode).toBe(0);
    expect(await fetchDescription(res.json<BoardTask>().id)).toEqual(doc);
  });

  it('update --description replaces and --clear-description nulls it', async () => {
    const md = 'Replaced with ~~old~~ **new** text';
    const update = await h.runCli([
      'task',
      'update',
      markdownTaskId,
      '--description',
      md,
      '--json',
    ]);
    expect(update.exitCode).toBe(0);
    expect(await fetchDescription(markdownTaskId)).toEqual(markdownToTiptap(md));

    const clear = await h.runCli([
      'task',
      'update',
      markdownTaskId,
      '--clear-description',
      '--json',
    ]);
    expect(clear.exitCode).toBe(0);
    expect(await fetchDescription(markdownTaskId)).toBeNull();
  });

  it('a GFM table exits 6 naming tables', async () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |';
    const res = await h.runCli([
      'task',
      'create',
      'Table described',
      '--project',
      projectId,
      '--description',
      table,
    ]);
    expect(res.exitCode).toBe(6);
    expect(res.stderr).toContain('tables');
  });

  it('mutually exclusive description flags exit 2', async () => {
    const path = join(tempDir, 'unused.md');
    await writeFile(path, 'unused');
    const create = await h.runCli([
      'task',
      'create',
      'Conflicting flags',
      '--project',
      projectId,
      '--description',
      'inline',
      '--description-file',
      path,
    ]);
    expect(create.exitCode).toBe(2);
    expect(create.stderr).toContain('at most one');

    const update = await h.runCli([
      'task',
      'update',
      markdownTaskId,
      '--description',
      'inline',
      '--clear-description',
    ]);
    expect(update.exitCode).toBe(2);
  });
});
