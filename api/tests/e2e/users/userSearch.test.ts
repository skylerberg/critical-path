import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { TestContext, type TestResponse, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { resetRateLimiter, USER_SEARCH_USER_MAX_ATTEMPTS } from '../../../src/services/rateLimit';
import { USER_SEARCH_LIMIT } from '../../../src/services/userSearch';

// Files share one database and this route reads every account in it, so every
// seeded name carries a token no other file uses and every assertion filters on
// it. Without that, a name another file left behind is an unexplained extra row.
const TAG = 'Zqxsearch';

interface Seeded {
  id: string;
  name: string;
}

describe('GET /api/users/search', () => {
  const ctx = new TestContext();
  const seededIds: string[] = [];
  const projectIds: string[] = [];
  let caller: TestUser;
  let other: TestUser;
  let skyler: Seeded;
  let ada: Seeded;

  async function seed(name: string): Promise<Seeded> {
    const id = newId();
    await db
      .insertInto('app_user')
      .values({
        id,
        email: `${id}@search.example.com`,
        password_hash: 'x',
        name,
      })
      .execute();
    seededIds.push(id);
    return { id, name };
  }

  async function search(query: string, token = caller.token): Promise<TestResponse> {
    return ctx.request(token).get(`/api/users/search?q=${encodeURIComponent(query)}`);
  }

  // Only rows this file seeded, so a stray account elsewhere in the shared
  // database cannot make an assertion pass or fail.
  async function names(query: string, token = caller.token): Promise<string[]> {
    const res = await search(query, token);
    expect(res.status).toBe(200);
    const body = await res.json<{ users: Array<{ id: string; name: string }> }>();
    return body.users.filter((u) => u.name.startsWith(TAG)).map((u) => u.name);
  }

  beforeAll(async () => {
    caller = await ctx.createUser('usersearch-caller');
    other = await ctx.createUser('usersearch-other');
    skyler = await seed(`${TAG} Skyler Berg`);
    ada = await seed(`${TAG} Ada Lovelace`);
  });

  afterAll(async () => {
    if (projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', projectIds).execute();
    }
    if (seededIds.length > 0) {
      await db.deleteFrom('app_user').where('id', 'in', seededIds).execute();
    }
    await ctx.cleanup();
  });

  beforeEach(() => {
    resetRateLimiter();
  });

  it('requires auth', async () => {
    const res = await ctx.request().get('/api/users/search?q=sky');
    expect(res.status).toBe(401);
  });

  describe('match semantics', () => {
    it('matches a prefix of a word', async () => {
      expect(await names('sky')).toContain(skyler.name);
    });

    it('matches a prefix of a later word', async () => {
      expect(await names('lovel')).toContain(ada.name);
    });

    it('requires every typed word to match, in any order', async () => {
      expect(await names('ada lo')).toContain(ada.name);
      expect(await names('lo ada')).toContain(ada.name);
    });

    it('does not match mid-word', async () => {
      expect(await names('kyler')).not.toContain(skyler.name);
    });

    it('is case-insensitive', async () => {
      expect(await names('SKYLER')).toContain(skyler.name);
    });

    // The name vector is built with the 'simple' configuration, which stems
    // nothing and drops no stop words. Switching it to 'english' would make
    // this person unfindable by their own name.
    it('finds a user whose name is a stop word', async () => {
      const the = await seed(`${TAG} The`);
      expect(await names('the')).toContain(the.name);
    });

    it('answers with nobody, not an error, for a query that tokenizes to nothing', async () => {
      const res = await search('&& &&');
      expect(res.status).toBe(200);
      expect((await res.json<{ users: unknown[] }>()).users).toEqual([]);
    });
  });

  describe('who is excluded', () => {
    it('never returns the caller', async () => {
      const res = await search(caller.name.split(' ')[0]!);
      expect(res.status).toBe(200);
      const body = await res.json<{ users: Array<{ id: string }> }>();
      expect(body.users.map((u) => u.id)).not.toContain(caller.id);
    });

    it('excludes someone the caller already shares a project with', async () => {
      const projectId = newId();
      projectIds.push(projectId);
      await db
        .insertInto('project')
        .values({ id: projectId, name: 'user search shared', created_by: caller.id })
        .execute();
      await db
        .insertInto('project_member')
        .values({ project_id: projectId, user_id: skyler.id })
        .execute();

      expect(await names('sky')).not.toContain(skyler.name);

      // Still listed by the directory route, which is the set this one is the
      // complement of.
      const directory = await ctx.request(caller.token).get('/api/users');
      const listed = await directory.json<{ users: Array<{ id: string }> }>();
      expect(listed.users.map((u) => u.id)).toContain(skyler.id);

      await db.deleteFrom('project').where('id', '=', projectId).execute();
      projectIds.pop();
    });

    // The limit is applied before the client can subtract the people it already
    // holds, so excluding collaborators server-side is what stops a common name
    // from answering with a page of rows the picker then discards.
    it('does not let collaborators crowd strangers out of the limit', async () => {
      const projectId = newId();
      projectIds.push(projectId);
      await db
        .insertInto('project')
        .values({ id: projectId, name: 'user search crowd', created_by: caller.id })
        .execute();

      const collaborators: Seeded[] = [];
      for (let i = 0; i < 12; i++) {
        collaborators.push(await seed(`${TAG}crowd Aaa${i}`));
      }
      await db
        .insertInto('project_member')
        .values(collaborators.map((u) => ({ project_id: projectId, user_id: u.id })))
        .execute();

      const strangers: Seeded[] = [];
      for (let i = 0; i < 3; i++) {
        strangers.push(await seed(`${TAG}crowd Zzz${i}`));
      }

      const res = await search(`${TAG}crowd`);
      expect(res.status).toBe(200);
      const body = await res.json<{ users: Array<{ id: string }> }>();
      const returned = body.users.map((u) => u.id);
      for (const stranger of strangers) {
        expect(returned).toContain(stranger.id);
      }
      for (const collaborator of collaborators) {
        expect(returned).not.toContain(collaborator.id);
      }

      await db.deleteFrom('project').where('id', '=', projectId).execute();
      projectIds.pop();
    });
  });

  describe('shape and ordering', () => {
    it('never exposes an email address', async () => {
      const res = await search('sky');
      const text = await res.text();
      expect(text).toContain(skyler.id);
      expect(text).not.toContain('@');
    });

    it('orders by name then id', async () => {
      const tag = `${TAG}order`;
      const first = await seed(`${tag} Bbb`);
      const second = await seed(`${tag} Aaa`);
      const dupeA = await seed(`${tag} Ccc`);
      const dupeB = await seed(`${tag} Ccc`);

      const res = await search(tag);
      const body = await res.json<{ users: Array<{ id: string; name: string }> }>();
      const ids = body.users.map((u) => u.id);
      expect(ids).toEqual([
        second.id,
        first.id,
        ...[dupeA.id, dupeB.id].sort((a, b) => (a < b ? -1 : 1)),
      ]);
    });

    it('caps the list and reports that it did', async () => {
      const tag = `${TAG}cap`;
      for (let i = 0; i < USER_SEARCH_LIMIT; i++) {
        await seed(`${tag} Person${i}`);
      }

      const exact = await search(tag);
      const exactBody = await exact.json<{ users: unknown[]; truncated: boolean }>();
      expect(exactBody.users).toHaveLength(USER_SEARCH_LIMIT);
      expect(exactBody.truncated).toBe(false);

      await seed(`${tag} PersonExtra`);

      const over = await search(tag);
      const overBody = await over.json<{ users: unknown[]; truncated: boolean }>();
      expect(overBody.users).toHaveLength(USER_SEARCH_LIMIT);
      expect(overBody.truncated).toBe(true);
    });
  });

  describe('query validation', () => {
    it.each([
      ['absent', '/api/users/search'],
      ['one character', '/api/users/search?q=a'],
      ['whitespace-padded to one character', '/api/users/search?q=%20%20a%20%20'],
      ['over 100 characters', `/api/users/search?q=${'a'.repeat(101)}`],
    ])('rejects a query that is %s', async (_label, path) => {
      const res = await ctx.request(caller.token).get(path);
      expect(res.status).toBe(400);
      expect(typeof (await res.json<{ error: unknown }>()).error).toBe('string');
    });
  });

  describe('rate limiting', () => {
    it('refuses past the per-account budget without refusing everyone else', async () => {
      for (let i = 0; i < USER_SEARCH_USER_MAX_ATTEMPTS; i++) {
        expect((await search('sky')).status).toBe(200);
      }
      expect((await search('sky')).status).toBe(429);

      // A different account on the same source address is unaffected until the
      // wider address budget runs out, which this file never reaches.
      expect((await search('sky', other.token)).status).toBe(200);
    });
  });
});
