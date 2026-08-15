import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { PassThrough } from 'node:stream';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import { configPath, saveConfig } from '../../src/config';
import { createContext, type CliDeps, type GlobalFlags } from '../../src/context';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardResponse'];

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

  it('--api-url sends the request there and keys the stored token by it', async () => {
    const fresh = await createCliHarness();
    const requests: string[] = [];
    const login = await fresh.runCli(
      [
        'login',
        '--email',
        user.email,
        '--password-stdin',
        '--api-url',
        'http://api.example.test:3001/',
      ],
      { stdin: `${user.password}\n`, onRequest: (request) => requests.push(request.url) }
    );
    expect(login.exitCode).toBe(0);
    expect(requests).toEqual(['http://api.example.test:3001/api/auth/login']);
    expect(await fresh.credentials.get('http://api.example.test:3001')).not.toBeNull();
    expect(await fresh.credentials.get('http://localhost:3001')).toBeNull();
  });

  it('resolves the API base URL from the flag, then the config file, then the default', async () => {
    const fresh = await createCliHarness();
    const silent = { write: () => undefined };
    const deps: CliDeps = {
      env: { CRITICAL_PATH_CONFIG_DIR: fresh.configDir },
      platform: 'linux',
      stdin: new PassThrough(),
      stdout: silent,
      stderr: silent,
      credentials: fresh.credentials,
    };
    const flags: GlobalFlags = { json: false, noInput: true, color: false };

    expect((await createContext(deps, flags)).baseUrl).toBe('https://criticalpath.skylerberg.com');

    await saveConfig(fresh.configDir, { api_url: 'http://config-host.test:3001/' });
    expect((await createContext(deps, flags)).baseUrl).toBe('http://config-host.test:3001');
    expect((await createContext(deps, { ...flags, apiUrl: 'http://flag-host.test' })).baseUrl).toBe(
      'http://flag-host.test'
    );
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

  it('set, get and unset round-trip web-url, storing it ready to have a path appended', async () => {
    const set = await h.runCli(['config', 'set', 'web-url', 'https://cp.example.test/']);
    expect(set.exitCode).toBe(0);

    const get = await h.runCli(['config', 'get', 'web-url']);
    expect(get.stdout.trim()).toBe('https://cp.example.test');

    const unset = await h.runCli(['config', 'unset', 'web-url']);
    expect(unset.exitCode).toBe(0);
    const after = await h.runCli(['config', 'get', 'web-url']);
    expect(after.stdout.trim()).toBe('');
  });

  it('set web-url rejects every value that cannot have a path appended', async () => {
    for (const value of [
      'cp.example.test',
      '/boards',
      'ftp://cp.example.test',
      'not a url',
      'https://cp.example.test/?a=1',
      'https://cp.example.test/#frag',
      'https://user:pw@cp.example.test',
    ]) {
      const res = await h.runCli(['config', 'set', 'web-url', value]);
      expect(res.exitCode).toBe(2);
    }
    const get = await h.runCli(['config', 'get', 'web-url']);
    expect(get.stdout.trim()).toBe('');
  });

  it('set default-project with an unresolvable ref exits 4 and stores nothing', async () => {
    const res = await h.runCli(['config', 'set', 'default-project', 'zz-no-such-project']);
    expect(res.exitCode).toBe(4);
    expect(res.stderr).toContain('zz-no-such-project');
    expect(res.stderr).not.toContain('default-project');

    const get = await h.runCli(['config', 'get', 'default-project']);
    expect(get.stdout.trim()).toBe(projectId);
  });

  it('a stale default-project blames the config and says how to fix it', async () => {
    const stale = crypto.randomUUID();
    const fresh = await createCliHarness();
    await fresh.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    await saveConfig(fresh.configDir, { default_project: stale });

    const res = await fresh.runCli(['ready']);
    expect(res.exitCode).toBe(4);
    expect(res.stderr).toContain(stale);
    expect(res.stderr).toContain('default-project');
    expect(res.stderr).toContain(configPath(fresh.configDir));
  });

  it('a stale CRITICAL_PATH_PROJECT names the variable', async () => {
    const stale = crypto.randomUUID();
    const res = await h.runCli(['ready'], { env: { CRITICAL_PATH_PROJECT: stale } });
    expect(res.exitCode).toBe(4);
    expect(res.stderr).toContain(stale);
    expect(res.stderr).toContain('CRITICAL_PATH_PROJECT');
  });
});
