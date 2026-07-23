import { describe, it, expect, afterAll } from 'vitest';
import { TestContext } from '../../../tests/setup/testContext';
import { db } from '../../../tests/helpers/database';
import { createCliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type User = components['schemas']['User'];

describe('auth commands', () => {
  const tc = new TestContext();
  const signupEmails: string[] = [];

  afterAll(async () => {
    if (signupEmails.length > 0) {
      await db.deleteFrom('app_user').where('app_user.email', 'in', signupEmails).execute();
    }
    await tc.cleanup();
  });

  it('login stores the token and whoami reports the user', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();

    const login = await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    expect(login.exitCode).toBe(0);
    expect(login.stdout).toContain(user.email);

    const who = await h.runCli(['whoami', '--json']);
    expect(who.exitCode).toBe(0);
    expect(who.json<User>().email).toBe(user.email);
  });

  it('whoami without a session exits 3 with a login hint', async () => {
    const h = await createCliHarness();
    const who = await h.runCli(['whoami']);
    expect(who.exitCode).toBe(3);
    expect(who.stderr).toContain('cpath login');
  });

  it('login with a wrong password exits 3 and stores nothing', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();
    const login = await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: 'wrong-password\n',
    });
    expect(login.exitCode).toBe(3);
    expect(await h.credentials.get('http://localhost:3001')).toBeNull();
  });

  it('logout revokes the session and clears the stored token', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const token = await h.credentials.get('http://localhost:3001');
    expect(token).not.toBeNull();

    const logout = await h.runCli(['logout']);
    expect(logout.exitCode).toBe(0);
    expect(await h.credentials.get('http://localhost:3001')).toBeNull();

    const res = await tc.request(token!).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('CRITICAL_PATH_TOKEN overrides the stored token', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();
    const who = await h.runCli(['whoami', '--json'], {
      env: { CRITICAL_PATH_TOKEN: user.token },
    });
    expect(who.exitCode).toBe(0);
    expect(who.json<User>().email).toBe(user.email);
  });

  it('signup creates an account and stores the token', async () => {
    const email = `cli-signup-${crypto.randomUUID()}@test.example.com`;
    signupEmails.push(email);
    const h = await createCliHarness();
    const signup = await h.runCli(
      ['signup', '--email', email, '--name', 'CLI Signup', '--password-stdin'],
      { stdin: 'test-password-123\n' }
    );
    expect(signup.exitCode).toBe(0);

    const who = await h.runCli(['whoami', '--json']);
    expect(who.json<User>().email).toBe(email);
  });

  it('account update changes the name', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const update = await h.runCli(['account', 'update', '--name', 'Renamed', '--json']);
    expect(update.exitCode).toBe(0);
    expect(update.json<User>().name).toBe('Renamed');
  });

  it('account update with no flags is a usage error', async () => {
    const h = await createCliHarness();
    const update = await h.runCli(['account', 'update']);
    expect(update.exitCode).toBe(2);
  });

  it('change-password stores the fresh token and revokes the old session', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const oldToken = await h.credentials.get('http://localhost:3001');

    const change = await h.runCli(['account', 'change-password', '--password-stdin'], {
      stdin: `${user.password}\nnew-password-456\n`,
    });
    expect(change.exitCode).toBe(0);

    const newToken = await h.credentials.get('http://localhost:3001');
    expect(newToken).not.toBeNull();
    expect(newToken).not.toBe(oldToken);

    const who = await h.runCli(['whoami', '--json']);
    expect(who.exitCode).toBe(0);

    const res = await tc.request(oldToken!).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('change-password with a wrong current password keeps the session', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const token = await h.credentials.get('http://localhost:3001');

    const change = await h.runCli(['account', 'change-password', '--password-stdin'], {
      stdin: 'wrong-password\nnew-password-456\n',
    });
    expect(change.exitCode).toBe(3);
    expect(change.stderr).toContain('Incorrect current password');
    expect(change.stderr).not.toContain('cpath login');

    expect(await h.credentials.get('http://localhost:3001')).toBe(token);
    const who = await h.runCli(['whoami']);
    expect(who.exitCode).toBe(0);
  });

  it('prompting fails cleanly under --no-input', async () => {
    const h = await createCliHarness();
    const login = await h.runCli(['login', '--no-input']);
    expect(login.exitCode).toBe(2);
    expect(login.stderr).toContain('--no-input');
  });
});
