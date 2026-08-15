import { describe, it, expect } from 'vitest';
import { TestContext, TestApiClient } from '../../setup/testContext';
import { uniqueEmail } from '../../helpers/fixtures';
import { RESET_IP_MAX_ATTEMPTS } from '../../../src/services/rateLimit';

// Every per-source budget is keyed on clientIp(), whose pure half is unit tested
// with an address handed to it. This is the other half: the wiring that finds
// one on the connection Hono was given. A caller that answers 'unknown' for it
// puts every client on earth in a single bucket, and nothing else notices.
describe('Budgets keyed by source address', () => {
  const ctx = new TestContext();

  async function forgotPassword(client: TestApiClient): Promise<number> {
    const res = await client.post('/api/auth/forgot-password', {
      email: uniqueEmail('source-address'),
    });
    return res.status;
  }

  async function exhaustResetBudget(client: TestApiClient): Promise<void> {
    for (let i = 0; i < RESET_IP_MAX_ATTEMPTS; i++) {
      expect(await forgotPassword(client)).toBe(404);
    }
  }

  it('charges the calling address and leaves another address its own budget', async () => {
    const caller = ctx.request().withSourceAddress('198.51.100.7');
    await exhaustResetBudget(caller);

    const exhausted = await caller.post('/api/auth/forgot-password', {
      email: uniqueEmail('source-address'),
    });
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toEqual({
      error: 'Too many password reset requests, please try again later',
    });

    expect(await forgotPassword(ctx.request().withSourceAddress('203.0.113.9'))).toBe(404);
  });

  it('keeps charging the socket address when an untrusted proxy header is forged', async () => {
    await exhaustResetBudget(ctx.request().withSourceAddress('198.51.100.7'));

    const forged = ctx
      .request(undefined, undefined, '203.0.113.9')
      .withSourceAddress('198.51.100.7');
    expect(await forgotPassword(forged)).toBe(429);
  });
});
