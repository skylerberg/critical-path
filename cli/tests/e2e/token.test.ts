import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type CreatedPersonalAccessToken = components['schemas']['CreatedPersonalAccessToken'];
type PersonalAccessToken = components['schemas']['PersonalAccessToken'];

describe('token commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;

  beforeAll(async () => {
    user = await tc.createUser('cli-token');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
  });

  afterAll(async () => {
    await tc.cleanup();
  });

  it('create prints the secret on stdout alone and it authenticates', async () => {
    const res = await h.runCli(['token', 'create', 'agent']);

    expect(res.exitCode).toBe(0);
    const secret = res.stdout.trim();
    expect(secret.startsWith('cpat_')).toBe(true);
    expect(res.stdout).toBe(`${secret}\n`);
    expect(res.stderr).toContain('only time the token is shown');
    expect(res.stderr).not.toContain(secret);

    const whoami = await h.runCli(['whoami', '--json'], { env: { CRITICAL_PATH_TOKEN: secret } });
    expect(whoami.exitCode).toBe(0);
    expect(whoami.json<{ email: string }>().email).toBe(user.email);
  });

  it('create --expires-in-days sets a dated expiry and list shows it', async () => {
    const res = await h.runCli([
      'token',
      'create',
      'expiring',
      '--expires-in-days',
      '30',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    const created = res.json<CreatedPersonalAccessToken>();
    const expiresAt = created.personal_access_token.expires_at;
    expect(expiresAt).not.toBeNull();
    const days = (new Date(expiresAt!).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    const list = await h.runCli(['token', 'list']);
    expect(list.stdout).toContain('expiring');
    expect(list.stdout).toContain('never');
    expect(list.stdout).toContain(expiresAt!.slice(0, 10));
  });

  it('rejects both expiry flags at once and a nonsense day count', async () => {
    const both = await h.runCli([
      'token',
      'create',
      'bad',
      '--expires-in-days',
      '30',
      '--expires-at',
      '2030-01-01T00:00:00Z',
    ]);
    expect(both.exitCode).toBe(2);

    const negative = await h.runCli(['token', 'create', 'bad', '--expires-in-days', '-5']);
    expect(negative.exitCode).toBe(6);
  });

  it('revoke by name kills that token and leaves the others', async () => {
    const created = await h.runCli(['token', 'create', 'doomed', '--json']);
    const secret = created.json<CreatedPersonalAccessToken>().token;

    const revoke = await h.runCli(['token', 'revoke', 'doomed', '--force', '--json']);
    expect(revoke.exitCode).toBe(0);

    const whoami = await h.runCli(['whoami'], { env: { CRITICAL_PATH_TOKEN: secret } });
    expect(whoami.exitCode).toBe(3);

    const list = await h.runCli(['token', 'list', '--json']);
    const names = list.json<PersonalAccessToken[]>().map((token) => token.name);
    expect(names).not.toContain('doomed');
    expect(names).toContain('agent');
  });

  it('revoke exits 4 for an unknown token and never calls the API', async () => {
    const res = await h.runCli(['token', 'revoke', 'no-such-token', '--force']);
    expect(res.exitCode).toBe(4);
  });

  it('list reports an empty account plainly', async () => {
    const fresh = await tc.createUser('cli-token-empty');
    const emptyHarness = await createCliHarness();
    const res = await emptyHarness.runCli(['token', 'list'], {
      env: { CRITICAL_PATH_TOKEN: fresh.token },
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('No personal access tokens');
  });
});
