import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, sessionCookieFrom, type TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { uploadPath, newId } from '../../helpers/fixtures';
import { cleanupProjects, createTaskFixture } from '../attachments/helpers';
import { SESSION_COOKIE_NAME } from '../../../src/services/sessionCookie';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// The image route serves the bytes an <img> renders, and an <img> cannot carry
// an Authorization header. These cover the two things that makes true: the
// cookie is a credential here, and a published board still serves a stranger.
describe('image route authentication', () => {
  const ctx = new TestContext();
  const createdProjectIds: string[] = [];

  let owner: TestUser;
  let outsider: TestUser;
  let cookie: string;
  let projectId: string;
  let imageId: string;

  beforeAll(async () => {
    owner = await ctx.createUser('media-owner');
    outsider = await ctx.createUser('media-outsider');

    const fixture = await createTaskFixture(owner.id, createdProjectIds);
    projectId = fixture.projectId;

    imageId = newId();
    const res = await ctx
      .request(owner.token)
      .postBytes(uploadPath(fixture.taskId, { filename: 'pixel.png', id: imageId }), PNG_1X1);
    expect(res.status).toBe(201);

    const login = await ctx
      .request()
      .post('/api/auth/login', { email: owner.email, password: owner.password });
    cookie = sessionCookieFrom(login)!;
    expect(cookie).not.toBeNull();
  });

  afterAll(async () => {
    await cleanupProjects(createdProjectIds);
    await ctx.cleanup();
  });

  async function setPublic(isPublic: boolean): Promise<void> {
    await db
      .updateTable('project')
      .set({ is_public: isPublic })
      .where('id', '=', projectId)
      .execute();
  }

  it('serves a member presenting only the session cookie', async () => {
    const res = await ctx.request().withCookie(cookie).get(`/api/images/${imageId}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('refuses an anonymous caller on a private board', async () => {
    expect((await ctx.request().get(`/api/images/${imageId}`)).status).toBe(401);
  });

  // Not 403: a non-member has no business learning that the id resolves.
  it('answers 404 to a signed-in non-member', async () => {
    expect((await ctx.request(outsider.token).get(`/api/images/${imageId}`)).status).toBe(404);
  });

  it('reads as anonymous when the cookie is stale rather than refusing outright', async () => {
    const res = await ctx
      .request()
      .withCookie(`${SESSION_COOKIE_NAME}=not-a-live-session-token`)
      .get(`/api/images/${imageId}`);

    // Anonymous, so a private board still refuses — but as 401, the same answer
    // a browser with no cookie gets, rather than an error about the cookie.
    expect(res.status).toBe(401);
  });

  it('still refuses a bad bearer token outright, which is nobody sending it by accident', async () => {
    const res = await ctx.request('not-a-real-token').get(`/api/images/${imageId}`);
    expect(res.status).toBe(401);
  });

  it('serves anyone once the board is published, and stops when it is unpublished', async () => {
    await setPublic(true);
    try {
      expect((await ctx.request().get(`/api/images/${imageId}`)).status).toBe(200);
      expect((await ctx.request(outsider.token).get(`/api/images/${imageId}`)).status).toBe(200);
    } finally {
      await setPublic(false);
    }

    // The leak the capability URL could never close: unpublishing now takes the
    // pictures back with the board.
    expect((await ctx.request().get(`/api/images/${imageId}`)).status).toBe(401);
    expect((await ctx.request(outsider.token).get(`/api/images/${imageId}`)).status).toBe(404);
  });

  it('does not accept the cookie on a mutating route, which is what keeps it CSRF-proof', async () => {
    const res = await ctx
      .request()
      .withCookie(cookie)
      .patch(`/api/attachments/${imageId}`, { title: 'Renamed by a cross-site form' });

    expect(res.status).toBe(401);
  });

  it('does not accept the cookie on an ordinary authenticated read either', async () => {
    expect((await ctx.request().withCookie(cookie).get('/api/projects')).status).toBe(401);
  });
});
