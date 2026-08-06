import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

import { rankKey } from '../../../tests/helpers/fixtures';
type Comment = components['schemas']['Comment'];

describe('comment commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let projectId: string;
  let taskId: string;
  let commentId: string;

  beforeAll(async () => {
    user = await tc.createUser('cli-comment');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });

    const client = tc.request(user.token);
    projectId = crypto.randomUUID();
    const project = await client.post('/api/projects', {
      id: projectId,
      name: 'CLI Comment Fixture',
    });
    expect(project.status).toBe(201);
    const board = (await project.json()) as components['schemas']['BoardResponse'];
    taskId = crypto.randomUUID();
    const task = await client.post('/api/tasks', {
      id: taskId,
      project_id: projectId,
      column_id: board.columns[0].id,
      title: 'Task with comments',
      sort_key: rankKey(1000),
    });
    expect(task.status).toBe(201);
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  it('prints No comments and an empty array for a task with none', async () => {
    const human = await h.runCli(['comment', 'list', taskId]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('No comments');
    const json = await h.runCli(['comment', 'list', taskId, '--json']);
    expect(json.json<Comment[]>()).toEqual([]);
  });

  it('adds a comment from a positional Markdown body', async () => {
    const res = await h.runCli(['comment', 'add', taskId, 'Looks **good**', '--json']);
    expect(res.exitCode).toBe(0);
    const added = res.json<Comment>();
    expect(added.task_id).toBe(taskId);
    expect(added.body).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Looks ' },
            { type: 'text', text: 'good', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    });
    commentId = added.id;
  });

  it('lists the full comment id, the author, and the round-tripped Markdown', async () => {
    const res = await h.runCli(['comment', 'list', 'Task with comments', '--project', projectId]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(commentId);
    expect(res.stdout).toContain(user.name);
    expect(res.stdout).toContain('Looks **good**');
    expect(res.stdout).not.toContain('(edited)');
  });

  it('rejects neither and both body sources with the usage exit code', async () => {
    const neither = await h.runCli(['comment', 'add', taskId]);
    expect(neither.exitCode).toBe(2);
    const both = await h.runCli(['comment', 'add', taskId, 'inline', '--body-file', '-'], {
      stdin: 'from stdin\n',
    });
    expect(both.exitCode).toBe(2);
  });

  it('reads the body from stdin with --body-file -', async () => {
    const res = await h.runCli(['comment', 'add', taskId, '--body-file', '-', '--json'], {
      stdin: 'piped body\n',
    });
    expect(res.exitCode).toBe(0);
    const added = res.json<Comment>();
    expect(JSON.stringify(added.body)).toContain('piped body');
    const cleanup = await h.runCli(['comment', 'delete', added.id, '--force']);
    expect(cleanup.exitCode).toBe(0);
  });

  it('edits a comment and marks it edited in the listing', async () => {
    const res = await h.runCli(['comment', 'edit', commentId, 'Revised note', '--json']);
    expect(res.exitCode).toBe(0);
    expect(JSON.stringify(res.json<Comment>().body)).toContain('Revised note');

    const list = await h.runCli(['comment', 'list', taskId]);
    expect(list.stdout).toContain('Revised note');
    expect(list.stdout).toContain('(edited)');
  });

  it('requires --force to delete without a prompt, then deletes', async () => {
    const prompted = await h.runCli(['comment', 'delete', commentId, '--no-input']);
    expect(prompted.exitCode).toBe(2);

    const res = await h.runCli(['comment', 'delete', commentId, '--force', '--json']);
    expect(res.exitCode).toBe(0);
    expect(res.json<{ deleted: boolean; id: string }>()).toEqual({ deleted: true, id: commentId });

    const list = await h.runCli(['comment', 'list', taskId, '--json']);
    expect(list.json<Comment[]>()).toEqual([]);
  });
});
