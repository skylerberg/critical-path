import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import type { ProjectAccent } from '../../../src/schemas/projects';

// Keyed by the union rather than restated as an array: a swatch added to
// `projectAccent` and not here fails the type check, and one added to both and
// not to the `project_color_valid` CHECK migration 0030 wrote fails the loop
// below with the 500 its users would have got.
const ACCENTS: Record<ProjectAccent, true> = {
  rose: true,
  amber: true,
  lime: true,
  emerald: true,
  sky: true,
  violet: true,
  fuchsia: true,
  slate: true,
};

describe('Project accent palette', () => {
  const ctx = new TestContext();
  const projectId = newId();
  let user: TestUser;

  beforeAll(async () => {
    user = await ctx.createUser('accent');
    const res = await ctx
      .request(user.token)
      .post('/api/projects', { id: projectId, name: 'Accents' });
    expect(res.status).toBe(201);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('stores every declared key', async () => {
    for (const color of Object.keys(ACCENTS) as ProjectAccent[]) {
      const res = await ctx.request(user.token).patch(`/api/projects/${projectId}`, { color });
      expect([color, res.status]).toEqual([color, 200]);
      expect((await res.json()).color).toBe(color);

      const row = await db
        .selectFrom('project')
        .select('color')
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow();
      expect(row.color).toBe(color);
    }
  });
});
