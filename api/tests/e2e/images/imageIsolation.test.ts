import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { imageUploadPath, newId } from '../../helpers/fixtures';
import { cleanupProjects, createTaskFixture, uploadPath } from '../attachments/helpers';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const PDF = Buffer.from('%PDF-1.4\nbody\n%%EOF\n');

// Images and file attachments share a table now, and the two are served under
// opposite rules: an image goes out unauthenticated with its real content type
// so an <img> can render it, a file only ever as an authenticated
// application/octet-stream download. Sharing storage must not let either id
// cross into the other's route — that crossing is what would turn an arbitrary
// upload into a script served from our own origin.
describe('image and file attachment isolation', () => {
  const ctx = new TestContext();
  const createdProjectIds: string[] = [];

  let user: Awaited<ReturnType<TestContext['createUser']>>;
  let imageId: string;
  let fileId: string;

  beforeAll(async () => {
    user = await ctx.createUser('img-iso');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    imageId = newId();
    const image = await ctx
      .request(user.token)
      .postBytes(imageUploadPath(taskId, 'pixel.png', imageId), PNG_1X1);
    expect(image.status).toBe(201);

    const upload = await ctx.request(user.token).postBytes(uploadPath(taskId, 'spec.pdf'), PDF);
    expect(upload.status).toBe(201);
    fileId = ((await upload.json()) as { id: string }).id;
  });

  afterAll(async () => {
    await cleanupProjects(createdProjectIds);
    await ctx.cleanup();
  });

  it('will not serve a file attachment through the unauthenticated image route', async () => {
    const res = await ctx.request().get(`/api/images/${fileId}`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).not.toContain('application/pdf');
  });

  it('will not serve a file attachment through the image route even to its owner', async () => {
    expect((await ctx.request(user.token).get(`/api/images/${fileId}`)).status).toBe(404);
  });

  it('will not serve an image through the attachment download route', async () => {
    expect((await ctx.request(user.token).get(`/api/attachments/${imageId}/download`)).status).toBe(
      404
    );
  });

  it('will not serve an image through the link preview or favicon routes', async () => {
    expect((await ctx.request().get(`/api/attachments/${imageId}/preview`)).status).toBe(404);
    expect((await ctx.request().get(`/api/attachments/${imageId}/favicon`)).status).toBe(404);
  });

  // Isolation is about which bytes each route can reach, not about which rows it
  // can name. An image is an attachment now, so the metadata routes reach it —
  // that is the point of the merge, and it takes nothing away from the rules
  // above, which are enforced by the columns each serving route selects.
  it('lets the attachment routes rename an image, which is now one of them', async () => {
    const res = await ctx
      .request(user.token)
      .patch(`/api/attachments/${imageId}`, { title: 'Mock-up' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; title: string; image_url: string };
    expect(body.kind).toBe('image');
    expect(body.title).toBe('Mock-up');
    expect(body.image_url).toBe(`/api/images/${imageId}`);
  });

  it('still serves the image itself, unauthenticated and with its sniffed type', async () => {
    const res = await ctx.request().get(`/api/images/${imageId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG_1X1)).toBe(true);
  });

  it('still serves the file itself, authenticated and never as a renderable type', async () => {
    const res = await ctx.request(user.token).get(`/api/attachments/${fileId}/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
