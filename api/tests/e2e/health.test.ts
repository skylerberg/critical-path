import { describe, it, expect } from 'vitest';
import { app } from '../../src/index';

// Both paths answer the same handler, and both are public — an unauthenticated
// readiness probe is the whole point.
describe('health', () => {
  it.each(['/health', '/'])('%s answers without a credential', async (path) => {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'healthy' });
  });

  // The reason the fields are there: a deployed pod has to be able to say which
  // build it is without anyone reading a workflow log.
  it('names the build it is running', async () => {
    const body = (await (await app.request('/health')).json()) as {
      branch: string | null;
      commit: string | null;
    };
    expect(body.branch).toBeTruthy();
    expect(body.commit).toMatch(/^[0-9a-f]{7}$/);
  });
});
