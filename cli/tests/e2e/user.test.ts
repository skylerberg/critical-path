import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../api/tests/setup/testContext';
import { db } from '../../../api/tests/helpers/database';
import { newId } from '../../../api/tests/helpers/fixtures';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type User = components['schemas']['User'];

// Shared with every other file in the run, so the seeded name carries a token
// nothing else uses and assertions filter on it.
const TAG = 'Qzcliuser';

describe('user search', () => {
  const tc = new TestContext();
  const seededIds: string[] = [];
  let caller: TestUser;
  let h: CliHarness;
  let strangerId: string;

  beforeAll(async () => {
    caller = await tc.createUser('cli-usersearch');
    h = await createCliHarness();
    await h.runCli(['login', '--email', caller.email, '--password-stdin'], {
      stdin: `${caller.password}\n`,
    });

    strangerId = newId();
    seededIds.push(strangerId);
    await db
      .insertInto('app_user')
      .values({
        id: strangerId,
        email: `${strangerId}@cli.example.com`,
        password_hash: 'x',
        name: `${TAG} Skyler Berg`,
      })
      .execute();
  });

  afterAll(async () => {
    if (seededIds.length > 0) {
      await db.deleteFrom('app_user').where('id', 'in', seededIds).execute();
    }
    await tc.cleanup();
  });

  it('finds someone the caller shares no project with', async () => {
    const res = await h.runCli(['user', 'search', `${TAG} sky`, '--json']);
    expect(res.exitCode).toBe(0);
    const body = res.json<{ users: User[]; truncated: boolean }>();
    expect(body.users.map((u) => u.id)).toContain(strangerId);
    expect(body.truncated).toBe(false);
  });

  it('prints a table of matches without --json', async () => {
    const res = await h.runCli(['user', 'search', `${TAG} sky`]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(`${TAG} Skyler Berg`);
    expect(res.stdout).toContain(strangerId.slice(0, 8));
  });

  it('reports nothing for a name that matches only mid-word', async () => {
    const res = await h.runCli(['user', 'search', 'kylerberg', '--json']);
    expect(res.exitCode).toBe(0);
    expect(res.json<{ users: User[] }>().users.map((u) => u.id)).not.toContain(strangerId);
  });

  it('surfaces the server refusal for a query below the minimum length', async () => {
    const res = await h.runCli(['user', 'search', 'a', '--json']);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).not.toBe('');
  });
});
