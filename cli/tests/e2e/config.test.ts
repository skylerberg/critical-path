import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardPayload'];

describe('config commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let projectId: string;

  beforeAll(async () => {
    user = await tc.createUser('cli-config');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const create = await h.runCli(['project', 'create', 'Config Default', '--json']);
    expect(create.exitCode).toBe(0);
    projectId = create.json<BoardPayload>().project.id;
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  it('path prints the config file location', async () => {
    const res = await h.runCli(['config', 'path']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toMatch(/config\.json$/);
  });

  it('set, get, and unset round-trip a value', async () => {
    const set = await h.runCli(['config', 'set', 'api-url', 'http://localhost:3001']);
    expect(set.exitCode).toBe(0);

    const get = await h.runCli(['config', 'get', 'api-url']);
    expect(get.exitCode).toBe(0);
    expect(get.stdout.trim()).toBe('http://localhost:3001');

    const whole = await h.runCli(['config', 'get', '--json']);
    expect(whole.json<{ api_url?: string }>().api_url).toBe('http://localhost:3001');

    const unset = await h.runCli(['config', 'unset', 'api-url']);
    expect(unset.exitCode).toBe(0);

    const after = await h.runCli(['config', 'get', 'api-url']);
    expect(after.exitCode).toBe(0);
    expect(after.stdout.trim()).toBe('');
  });

  it('rejects unknown keys with a usage error', async () => {
    const set = await h.runCli(['config', 'set', 'bogus', 'x']);
    expect(set.exitCode).toBe(2);
    expect(set.stderr).toContain('bogus');

    const get = await h.runCli(['config', 'get', 'bogus']);
    expect(get.exitCode).toBe(2);

    const unset = await h.runCli(['config', 'unset', 'bogus']);
    expect(unset.exitCode).toBe(2);
  });

  it('set default-project resolves a name to the project id', async () => {
    const set = await h.runCli(['config', 'set', 'default-project', 'Config Default']);
    expect(set.exitCode).toBe(0);

    const get = await h.runCli(['config', 'get', 'default-project']);
    expect(get.stdout.trim()).toBe(projectId);
  });

  it('a default project makes --project optional', async () => {
    const res = await h.runCli(['column', 'list', '--json']);
    expect(res.exitCode).toBe(0);
    const names = res.json<{ name: string }[]>().map((c) => c.name);
    expect(names).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
  });

  it('set default-project with an unresolvable ref exits 4 and stores nothing', async () => {
    const res = await h.runCli(['config', 'set', 'default-project', 'zz-no-such-project']);
    expect(res.exitCode).toBe(4);

    const get = await h.runCli(['config', 'get', 'default-project']);
    expect(get.stdout.trim()).toBe(projectId);
  });
});
