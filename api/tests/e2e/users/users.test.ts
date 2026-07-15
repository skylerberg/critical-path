import { describe, it, expect, afterAll } from 'vitest';
import { TestContext } from '../../setup/testContext';

describe('GET /api/users', () => {
  const ctx = new TestContext();

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('requires auth', async () => {
    const res = await ctx.request().get('/api/users');
    expect(res.status).toBe(401);
  });

  it('lists users with id, email, and name ordered by name', async () => {
    const first = await ctx.createUser('aaa-users-order');
    const last = await ctx.createUser('zzz-users-order');

    const res = await ctx.request(first.token).get('/api/users');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.users)).toBe(true);

    const firstIndex = body.users.findIndex((u: { id: string }) => u.id === first.id);
    const lastIndex = body.users.findIndex((u: { id: string }) => u.id === last.id);
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(lastIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeLessThan(lastIndex);

    expect(body.users[firstIndex]).toEqual({
      id: first.id,
      email: first.email,
      name: first.name,
    });
  });
});
