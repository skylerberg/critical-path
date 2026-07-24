import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { describe, it, expect, afterAll } from 'vitest';
import sharp from 'sharp';
import { TestContext } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { db } from '../../../src/db/index';
import { env } from '../../../src/config/env';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function avatarForm(bytes: Buffer, filename = 'avatar.png', mimeType = 'image/png'): FormData {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], filename, { type: mimeType }));
  return form;
}

function storageKeyOf(avatarUrl: string): string {
  return avatarUrl.replace('/api/avatars/', '');
}

describe('Avatars', () => {
  const ctx = new TestContext();
  const uploadedKeys: string[] = [];

  function trackKey(avatarUrl: string): string {
    const key = storageKeyOf(avatarUrl);
    uploadedKeys.push(key);
    return key;
  }

  afterAll(async () => {
    await Promise.all(
      uploadedKeys.map((key) => fs.rm(path.join(env.storageDiskRoot, key), { force: true }))
    );
    await ctx.cleanup();
  });

  describe('POST /api/auth/me/avatar', () => {
    it('uploads a PNG, re-encodes it as WebP, and serves it back immutably', async () => {
      const user = await ctx.createUser('avatar-upload');

      const res = await ctx
        .request(user.token)
        .postMultipart('/api/auth/me/avatar', avatarForm(PNG_1X1));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: expect.stringMatching(/^\/api\/avatars\/[0-9a-f-]{36}$/),
      });
      trackKey(body.avatar_url);

      const row = await db
        .selectFrom('app_user')
        .select(['avatar_storage_key', 'avatar_content_type'])
        .where('id', '=', user.id)
        .executeTakeFirstOrThrow();
      expect(row.avatar_storage_key).toBe(storageKeyOf(body.avatar_url));
      expect(row.avatar_content_type).toBe('image/webp');

      const get = await ctx.request().get(body.avatar_url);
      expect(get.status).toBe(200);
      expect(get.headers.get('Content-Type')).toBe('image/webp');
      expect(get.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');

      const bytes = Buffer.from(await get.arrayBuffer());
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString('latin1')).toBe('WEBP');
    });

    it('downscales large images to fit within 1024x1024 without enlarging small ones', async () => {
      const user = await ctx.createUser('avatar-resize');

      const bigPng = await sharp({
        create: { width: 2000, height: 800, channels: 3, background: '#3366cc' },
      })
        .png()
        .toBuffer();
      const bigRes = await ctx
        .request(user.token)
        .postMultipart('/api/auth/me/avatar', avatarForm(bigPng));
      expect(bigRes.status).toBe(200);
      const bigBody = await bigRes.json();
      trackKey(bigBody.avatar_url);

      const bigGet = await ctx.request().get(bigBody.avatar_url);
      const bigMeta = await sharp(Buffer.from(await bigGet.arrayBuffer())).metadata();
      expect(bigMeta.format).toBe('webp');
      expect(bigMeta.width).toBe(1024);
      expect(bigMeta.height).toBe(410);

      const smallRes = await ctx
        .request(user.token)
        .postMultipart('/api/auth/me/avatar', avatarForm(PNG_1X1));
      expect(smallRes.status).toBe(200);
      const smallBody = await smallRes.json();
      trackKey(smallBody.avatar_url);

      const smallGet = await ctx.request().get(smallBody.avatar_url);
      const smallMeta = await sharp(Buffer.from(await smallGet.arrayBuffer())).metadata();
      expect(smallMeta.width).toBe(1);
      expect(smallMeta.height).toBe(1);
    });

    it('replaces the previous avatar, deleting its object and 404ing its old URL', async () => {
      const user = await ctx.createUser('avatar-replace');

      const first = await ctx
        .request(user.token)
        .postMultipart('/api/auth/me/avatar', avatarForm(PNG_1X1));
      expect(first.status).toBe(200);
      const firstUrl = (await first.json()).avatar_url;
      const firstKey = trackKey(firstUrl);
      const firstPath = path.join(env.storageDiskRoot, firstKey);
      expect(existsSync(firstPath)).toBe(true);

      const second = await ctx
        .request(user.token)
        .postMultipart('/api/auth/me/avatar', avatarForm(PNG_1X1));
      expect(second.status).toBe(200);
      const secondUrl = (await second.json()).avatar_url;
      trackKey(secondUrl);
      expect(secondUrl).not.toBe(firstUrl);

      expect((await ctx.request().get(firstUrl)).status).toBe(404);
      // Storage deletion runs in a post-commit hook that is not awaited.
      await expect.poll(() => existsSync(firstPath), { timeout: 5000 }).toBe(false);
      expect((await ctx.request().get(secondUrl)).status).toBe(200);
    });

    it('rejects bytes that match no supported format with 422', async () => {
      const user = await ctx.createUser('avatar-garbage');

      const res = await ctx
        .request(user.token)
        .postMultipart(
          '/api/auth/me/avatar',
          avatarForm(Buffer.from('definitely not an image'), 'fake.png')
        );
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBeTypeOf('string');
    });

    it('rejects an image that sniffs as PNG but cannot be decoded with 422', async () => {
      const user = await ctx.createUser('avatar-corrupt');

      const corrupt = Buffer.concat([PNG_1X1.subarray(0, 8), Buffer.from('garbage payload')]);
      const res = await ctx
        .request(user.token)
        .postMultipart('/api/auth/me/avatar', avatarForm(corrupt));
      expect(res.status).toBe(422);
    });

    it('rejects files over 10 MB with 413', async () => {
      const user = await ctx.createUser('avatar-toobig');

      const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
      PNG_1X1.copy(oversized);
      const res = await ctx
        .request(user.token)
        .postMultipart('/api/auth/me/avatar', avatarForm(oversized, 'big.png'));
      expect(res.status).toBe(413);
    });

    it('rejects request bodies over the 11 MB route limit with 413', async () => {
      const user = await ctx.createUser('avatar-body-limit');

      const oversized = Buffer.alloc(11 * 1024 * 1024 + 1024);
      const res = await ctx
        .request(user.token)
        .postMultipart('/api/auth/me/avatar', avatarForm(oversized, 'huge.png'));
      expect(res.status).toBe(413);
    });

    it('returns 400 when the file field is missing', async () => {
      const user = await ctx.createUser('avatar-no-file');

      const res = await ctx
        .request(user.token)
        .postMultipart('/api/auth/me/avatar', new FormData());
      expect(res.status).toBe(400);
    });

    it('requires auth', async () => {
      const res = await ctx.request().postMultipart('/api/auth/me/avatar', avatarForm(PNG_1X1));
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/avatars/:id', () => {
    it('returns 404 for an unknown key', async () => {
      const res = await ctx.request().get(`/api/avatars/${newId()}`);
      expect(res.status).toBe(404);
    });

    it('returns 400 for a malformed key', async () => {
      const res = await ctx.request().get('/api/avatars/not-a-uuid');
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/auth/me/avatar', () => {
    it('clears the avatar, deletes the object, and 404s the old URL', async () => {
      const user = await ctx.createUser('avatar-delete');

      const upload = await ctx
        .request(user.token)
        .postMultipart('/api/auth/me/avatar', avatarForm(PNG_1X1));
      const avatarUrl = (await upload.json()).avatar_url;
      const key = trackKey(avatarUrl);
      const filePath = path.join(env.storageDiskRoot, key);
      expect(existsSync(filePath)).toBe(true);

      const res = await ctx.request(user.token).delete('/api/auth/me/avatar');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: null,
      });

      const row = await db
        .selectFrom('app_user')
        .select(['avatar_storage_key', 'avatar_content_type'])
        .where('id', '=', user.id)
        .executeTakeFirstOrThrow();
      expect(row.avatar_storage_key).toBeNull();
      expect(row.avatar_content_type).toBeNull();

      expect((await ctx.request().get(avatarUrl)).status).toBe(404);
      await expect.poll(() => existsSync(filePath), { timeout: 5000 }).toBe(false);

      const again = await ctx.request(user.token).delete('/api/auth/me/avatar');
      expect(again.status).toBe(200);
      expect((await again.json()).avatar_url).toBeNull();
    });

    it('requires auth', async () => {
      const res = await ctx.request().delete('/api/auth/me/avatar');
      expect(res.status).toBe(401);
    });
  });

  describe('avatar_url in user-shaped responses', () => {
    it('appears in GET /api/auth/me and GET /api/users after upload', async () => {
      const user = await ctx.createUser('avatar-shapes');

      const upload = await ctx
        .request(user.token)
        .postMultipart('/api/auth/me/avatar', avatarForm(PNG_1X1));
      const avatarUrl = (await upload.json()).avatar_url;
      trackKey(avatarUrl);

      const me = await ctx.request(user.token).get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(await me.json()).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: avatarUrl,
      });

      const users = await ctx.request(user.token).get('/api/users');
      expect(users.status).toBe(200);
      const body = await users.json();
      expect(body.users).toEqual([
        { id: user.id, email: user.email, name: user.name, avatar_url: avatarUrl },
      ]);

      const login = await ctx
        .request()
        .post('/api/auth/login', { email: user.email, password: user.password });
      expect(login.status).toBe(200);
      expect((await login.json()).user.avatar_url).toBe(avatarUrl);
    });
  });
});
