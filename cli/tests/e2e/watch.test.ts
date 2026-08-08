import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import {
  attachRealtime,
  projectSockets,
  socketsForUser,
  type RealtimeHandle,
} from '../../../src/services/realtime/index';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { newId } from '../../../tests/helpers/fixtures';
import { waitFor } from '../../../tests/e2e/projects/helpers';
import { createCliHarness, type CliHarness, type CliRunHandle, type CliRunResult } from './helpers';
import { rankKey } from '../../../tests/helpers/fixtures';

interface EventLine {
  type: string;
  project_id: string | null;
  data: Record<string, unknown>;
}

function eventLines(handle: CliRunHandle): EventLine[] {
  return handle
    .output()
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as EventLine);
}

async function waitForLine(
  handle: CliRunHandle,
  predicate: (event: EventLine) => boolean,
  label = 'a matching event line'
): Promise<EventLine> {
  let found: EventLine | undefined;
  await waitFor(async () => {
    found = eventLines(handle).find(predicate);
    return found !== undefined;
  }, label);
  return found as EventLine;
}

describe('watch command', () => {
  const tc = new TestContext();
  let server: ServerType;
  let realtime: RealtimeHandle;
  let baseEnv: Record<string, string>;
  let user: TestUser;
  let h: CliHarness;
  let alpha: { id: string; columnId: string };
  let beta: { id: string; columnId: string };
  const projectIds: string[] = [];

  async function createProject(name: string): Promise<{ id: string; columnId: string }> {
    const id = newId();
    const res = await tc.request(user.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { columns: { id: string }[] };
    projectIds.push(id);
    return { id, columnId: payload.columns[0].id };
  }

  // `done` resolves as soon as the close frame is queued, so without draining the server
  // still counts the finished command's socket while the next test waits on that count.
  async function stopWatch(handle: CliRunHandle): Promise<CliRunResult> {
    handle.interrupt();
    const result = await handle.done;
    await waitFor(async () => socketsForUser(user.id).length === 0, 'the watch socket to drain');
    return result;
  }

  async function createTask(project: { id: string; columnId: string }, title: string) {
    const res = await tc.request(user.token).post('/api/tasks', {
      id: newId(),
      project_id: project.id,
      column_id: project.columnId,
      title,
      sort_key: rankKey(1000),
    });
    expect(res.status).toBe(201);
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        // Credentials are keyed by base URL, so every harness call in this file must
        // agree on it; only the WebSocket actually travels over this port.
        baseEnv = { CRITICAL_PATH_API_URL: `http://127.0.0.1:${info.port}` };
        resolve();
      });
    });
    realtime = attachRealtime(server);

    user = await tc.createUser('cli-watch');
    h = await createCliHarness();
    const login = await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
      env: baseEnv,
    });
    expect(login.exitCode).toBe(0);

    alpha = await createProject('CLI Watch Alpha');
    beta = await createProject('CLI Watch Beta');
  });

  afterAll(async () => {
    const client = tc.request(user.token);
    for (const id of projectIds) {
      await client.delete(`/api/projects/${id}`);
    }
    realtime.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await tc.cleanup();
  });

  it('streams a scoped project as NDJSON and exits 0 on interrupt', async () => {
    const handle = h.startCli(['watch', '--project', 'CLI Watch Alpha'], { env: baseEnv });
    await waitFor(async () => projectSockets(alpha.id).length === 1, 'alpha subscribed');

    await createTask(alpha, 'Watched task');
    const event = await waitForLine(handle, (e) => e.type === 'task_created');

    expect(event.project_id).toBe(alpha.id);
    expect(event.data.title).toBe('Watched task');
    for (const line of eventLines(handle)) {
      expect(['auth_ok', 'ping', 'pong']).not.toContain(line.type);
    }
    expect(handle.errorOutput()).toContain('CLI Watch Alpha');

    const result = await stopWatch(handle);
    expect(result.exitCode).toBe(0);
  });

  it('drops events from projects other than the scoped one', async () => {
    const handle = h.startCli(['watch', '--project', 'CLI Watch Alpha'], { env: baseEnv });
    await waitFor(async () => projectSockets(alpha.id).length === 1, 'alpha subscribed');

    await createTask(beta, 'Beta only task');
    // A project rename is broadcast to every authenticated socket regardless of its
    // subscriptions, so only the client-side scope filter can keep it out of the stream.
    const renamed = await tc
      .request(user.token)
      .patch(`/api/projects/${beta.id}`, { name: 'CLI Watch Beta Renamed' });
    expect(renamed.status).toBe(200);
    await createTask(alpha, 'Alpha marker task');
    await waitForLine(handle, (e) => e.data.title === 'Alpha marker task');

    expect(eventLines(handle).map((e) => e.data.title)).not.toContain('Beta only task');
    expect(eventLines(handle).every((e) => e.project_id === alpha.id)).toBe(true);

    expect((await stopWatch(handle)).exitCode).toBe(0);
  });

  it('follows every accessible project when no --project is given', async () => {
    const handle = h.startCli(['watch'], { env: baseEnv });
    await waitFor(
      async () => projectSockets(alpha.id).length === 1 && projectSockets(beta.id).length === 1,
      'alpha and beta subscribed'
    );

    await createTask(alpha, 'Alpha broad task');
    await createTask(beta, 'Beta broad task');

    const alphaLine = await waitForLine(handle, (e) => e.data.title === 'Alpha broad task');
    const betaLine = await waitForLine(handle, (e) => e.data.title === 'Beta broad task');
    expect(alphaLine.project_id).toBe(alpha.id);
    expect(betaLine.project_id).toBe(beta.id);

    expect((await stopWatch(handle)).exitCode).toBe(0);
  });

  it('ignores CRITICAL_PATH_PROJECT and follows every project anyway', async () => {
    const handle = h.startCli(['watch'], {
      env: { ...baseEnv, CRITICAL_PATH_PROJECT: 'CLI Watch Alpha' },
    });
    await waitFor(
      async () => projectSockets(alpha.id).length === 1 && projectSockets(beta.id).length === 1,
      'alpha and beta subscribed'
    );

    await createTask(alpha, 'Alpha unscoped task');
    await createTask(beta, 'Beta unscoped task');

    const alphaLine = await waitForLine(handle, (e) => e.data.title === 'Alpha unscoped task');
    const betaLine = await waitForLine(handle, (e) => e.data.title === 'Beta unscoped task');
    expect(alphaLine.project_id).toBe(alpha.id);
    expect(betaLine.project_id).toBe(beta.id);

    expect((await stopWatch(handle)).exitCode).toBe(0);
  });

  it('reconnects and resubscribes after the server drops the socket', async () => {
    const handle = h.startCli(['watch', '--project', 'CLI Watch Alpha'], { env: baseEnv });
    await waitFor(async () => projectSockets(alpha.id).length === 1, 'alpha subscribed');

    socketsForUser(user.id)[0].close(1001, 'dropped by the test');
    await waitFor(async () => socketsForUser(user.id).length === 0, 'the drop to land');
    // A full reconnect: the client's first backoff is a second on its own.
    await waitFor(async () => projectSockets(alpha.id).length === 1, 'alpha resubscribed', 15_000);

    await createTask(alpha, 'Post reconnect task');
    const event = await waitForLine(handle, (e) => e.data.title === 'Post reconnect task');
    expect(event.project_id).toBe(alpha.id);
    expect(handle.errorOutput()).toContain('Connection restored');

    expect((await stopWatch(handle)).exitCode).toBe(0);
  });

  it('subscribes to projects created while it is running', async () => {
    const handle = h.startCli(['watch'], { env: baseEnv });
    await waitFor(async () => projectSockets(alpha.id).length === 1, 'alpha subscribed');

    const late = await createProject('CLI Watch Latecomer');
    await waitForLine(handle, (e) => e.type === 'project_created' && e.data.id === late.id);
    // The subscribe frame round-trips independently of the emitted line.
    await waitFor(async () => projectSockets(late.id).length === 1, 'latecomer subscribed');

    await createTask(late, 'Latecomer task');
    const event = await waitForLine(handle, (e) => e.data.title === 'Latecomer task');
    expect(event.project_id).toBe(late.id);

    expect((await stopWatch(handle)).exitCode).toBe(0);
  });

  it('exits 3 with a login hint when the session is revoked', async () => {
    const revoked = await tc.createUser('cli-watch-revoked');
    const rh = await createCliHarness();
    const login = await rh.runCli(['login', '--email', revoked.email, '--password-stdin'], {
      stdin: `${revoked.password}\n`,
      env: baseEnv,
    });
    expect(login.exitCode).toBe(0);
    const cliToken = await rh.credentials.get(baseEnv.CRITICAL_PATH_API_URL);
    expect(cliToken).not.toBeNull();

    const handle = rh.startCli(['watch'], { env: baseEnv });
    await waitFor(async () => socketsForUser(revoked.id).length === 1, 'the socket to open');

    // Plain logout only deletes the session row; the socket would not notice until the
    // heartbeat re-check. Revoking the session publishes the revocation immediately.
    const list = await tc.request(cliToken as string).get('/api/auth/sessions');
    expect(list.status).toBe(200);
    const { sessions } = (await list.json()) as { sessions: { id: string; is_current: boolean }[] };
    const current = sessions.find((entry) => entry.is_current);
    if (current === undefined) {
      throw new Error('no current session to revoke');
    }

    const res = await tc.request(cliToken as string).delete(`/api/auth/sessions/${current.id}`);
    expect(res.status).toBe(204);

    const result = await handle.done;
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('cpath login');
  });

  it('exits 3 without opening a socket when the token is rejected', async () => {
    const before = socketsForUser(user.id).length;
    const result = await h.runCli(['watch'], {
      env: { ...baseEnv, CRITICAL_PATH_TOKEN: 'not-a-real-token' },
    });
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe('');
    expect(socketsForUser(user.id).length).toBe(before);
  });

  it('exits 4 for an unknown --project reference', async () => {
    const result = await h.runCli(['watch', '--project', 'no-such-project-anywhere'], {
      env: baseEnv,
    });
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe('');
  });
});
