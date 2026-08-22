import { describe, it, expect, afterAll } from 'vitest';
import { TestContext } from '../../../api/tests/setup/testContext';
import { db } from '../../../api/tests/helpers/database';
import { createCliHarness } from './helpers';
import { createResetToken } from '../../../api/src/services/resetToken';
import type { components } from '../../src/api/api.generated';

type Me = components['schemas']['Me'];

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
    expect(who.json<Me>().email).toBe(user.email);
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
    expect(who.json<Me>().email).toBe(user.email);
  });

  it('reset-password stores the session it is answered with', async () => {
    const user = await tc.createUser('cli-reset');
    const { alternative_id } = await db
      .selectFrom('app_user')
      .select('app_user.alternative_id')
      .where('app_user.id', '=', user.id)
      .executeTakeFirstOrThrow();
    const h = await createCliHarness();

    const reset = await h.runCli(
      [
        'account',
        'reset-password',
        '--token',
        createResetToken(alternative_id),
        '--password-stdin',
      ],
      { stdin: 'cli-reset-password-123\n' }
    );
    expect(reset.exitCode).toBe(0);
    expect(reset.stdout).toContain(user.email);

    const who = await h.runCli(['whoami', '--json']);
    expect(who.json<Me>().email).toBe(user.email);
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
    expect(who.json<Me>().email).toBe(email);
  });

  it('account update changes the name', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const update = await h.runCli(['account', 'update', '--name', 'Renamed', '--json']);
    expect(update.exitCode).toBe(0);
    expect(update.json<Me>().name).toBe('Renamed');
  });

  it('account update with no flags is a usage error', async () => {
    const h = await createCliHarness();
    const update = await h.runCli(['account', 'update']);
    expect(update.exitCode).toBe(2);
  });

  it('change-password keeps the stored token working', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const token = await h.credentials.get('http://localhost:3001');

    const change = await h.runCli(['account', 'change-password', '--password-stdin'], {
      stdin: `${user.password}\nnew-password-456\n`,
    });
    expect(change.exitCode).toBe(0);

    expect(await h.credentials.get('http://localhost:3001')).toBe(token);

    const who = await h.runCli(['whoami', '--json']);
    expect(who.exitCode).toBe(0);

    const res = await tc.request(token!).get('/api/auth/me');
    expect(res.status).toBe(200);

    const withNew = await tc
      .request()
      .post('/api/auth/login', { email: user.email, password: 'new-password-456' });
    expect(withNew.status).toBe(200);
    const withOld = await tc
      .request()
      .post('/api/auth/login', { email: user.email, password: user.password });
    expect(withOld.status).toBe(401);
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

  it('account delete removes the account and forgets the token', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });

    const del = await h.runCli(['account', 'delete', '--password-stdin', '--force', '--json'], {
      stdin: `${user.password}\n`,
    });
    expect(del.exitCode).toBe(0);
    expect(del.json<{ deleted: boolean }>()).toEqual({ deleted: true });
    expect(await h.credentials.get('http://localhost:3001')).toBeNull();

    const row = await db
      .selectFrom('app_user')
      .select('id')
      .where('id', '=', user.id)
      .executeTakeFirst();
    expect(row).toBeUndefined();

    const who = await h.runCli(['whoami']);
    expect(who.exitCode).toBe(3);
  });

  it('account delete with a wrong password exits 3 and keeps the session', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const token = await h.credentials.get('http://localhost:3001');

    const del = await h.runCli(['account', 'delete', '--password-stdin', '--force'], {
      stdin: 'wrong-password\n',
    });
    expect(del.exitCode).toBe(3);
    expect(del.stderr).toContain('Incorrect password');
    expect(del.stderr).not.toContain('cpath login');

    expect(await h.credentials.get('http://localhost:3001')).toBe(token);
    expect((await h.runCli(['whoami'])).exitCode).toBe(0);
  });

  it('account delete on a dead session keeps the login hint', async () => {
    const h = await createCliHarness();
    const del = await h.runCli(['account', 'delete', '--password-stdin', '--force'], {
      stdin: 'whatever\n',
      env: { CRITICAL_PATH_TOKEN: 'not-a-real-token' },
    });
    expect(del.exitCode).toBe(3);
    expect(del.stderr).not.toContain('Incorrect password');
    expect(del.stderr).toContain('cpath login');
  });

  it('account delete exits 5 and names the board while one is still shared', async () => {
    const owner = await tc.createUser('cli-auth');
    const member = await tc.createUser('cli-auth');
    const projectId = crypto.randomUUID();
    const created = await tc
      .request(owner.token)
      .post('/api/projects', { id: projectId, name: 'Shared Ledger' });
    expect(created.status).toBe(201);
    await tc.request(owner.token).put(`/api/projects/${projectId}/members`, {
      user_ids: [member.id],
    });

    const h = await createCliHarness();
    await h.runCli(['login', '--email', owner.email, '--password-stdin'], {
      stdin: `${owner.password}\n`,
    });
    const del = await h.runCli(['account', 'delete', '--password-stdin', '--force'], {
      stdin: `${owner.password}\n`,
    });
    expect(del.exitCode).toBe(5);
    expect(del.stderr).toContain('Shared Ledger');

    expect((await h.runCli(['whoami'])).exitCode).toBe(0);
  });

  it('account delete refuses --password-stdin without --force instead of hanging', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });

    const requests: string[] = [];
    const del = await h.runCli(['account', 'delete', '--password-stdin'], {
      stdin: `${user.password}\n`,
      onRequest: (request) => requests.push(request.method),
    });
    expect(del.exitCode).toBe(2);
    expect(del.stderr).toContain('--password-stdin requires --force');
    expect(requests).toEqual([]);
    expect((await h.runCli(['whoami'])).exitCode).toBe(0);
  });

  it('account delete under --no-input without --force exits 2 without asking the server', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });

    const requests: string[] = [];
    const del = await h.runCli(['account', 'delete', '--no-input'], {
      onRequest: (request) => requests.push(request.method),
    });
    expect(del.exitCode).toBe(2);
    expect(requests).toEqual([]);
    expect((await h.runCli(['whoami'])).exitCode).toBe(0);
  });

  it('prompting fails cleanly under --no-input', async () => {
    const h = await createCliHarness();
    const login = await h.runCli(['login', '--no-input']);
    expect(login.exitCode).toBe(2);
    expect(login.stderr).toContain('--no-input');
  });

  it('account forgot-password confirms the send for a known address', async () => {
    const user = await tc.createUser('cli-auth');
    const h = await createCliHarness();
    const forgot = await h.runCli(['account', 'forgot-password', '--email', user.email, '--json']);
    expect(forgot.exitCode).toBe(0);
    expect(forgot.json<{ sent: boolean }>()).toEqual({ sent: true });
  });

  it('account forgot-password exits 4 and says so for an unknown address', async () => {
    const h = await createCliHarness();
    const forgot = await h.runCli([
      'account',
      'forgot-password',
      '--email',
      `cli-nobody-${crypto.randomUUID()}@test.example.com`,
    ]);
    expect(forgot.exitCode).toBe(4);
    expect(forgot.stderr).toContain('No account exists');
  });
});
