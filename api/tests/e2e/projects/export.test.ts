import { promises as fs } from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unzipSync } from 'fflate';
import { TestContext, type TestUser } from '../../setup/testContext';
import { imageStorageKey, uploadPath, newId, rankKey } from '../../helpers/fixtures';
import { insertTaskImage } from './helpers';
import { db } from '../../../src/db/index';
import { env } from '../../../src/config/env';
import type { ProjectExport, TiptapDoc } from '../../../src/schemas/index';
import { insertTaskImages } from '../../../src/services/attachments/images';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64'
);

const CSV_HEADER =
  'id,title,column,is_done,position,due_date,labels,assignees,blocked_by,image_count,attachment_count,created_at,updated_at,archived_at,checklist,description';

const ctx = new TestContext();
const createdProjectIds: string[] = [];

async function createProject(user: TestUser, name: string): Promise<string> {
  const id = newId();
  const res = await ctx.request(user.token).post('/api/projects', { id, name });
  expect(res.status).toBe(201);
  createdProjectIds.push(id);
  return id;
}

async function columnsOf(projectId: string, token: string): Promise<Array<{ id: string }>> {
  const res = await ctx.request(token).get(`/api/projects/${projectId}`);
  expect(res.status).toBe(200);
  return (await res.json()).columns;
}

async function exportJson(projectId: string, token: string): Promise<ProjectExport> {
  const res = await ctx.request(token).get(`/api/projects/${projectId}/export?format=json`);
  expect(res.status).toBe(200);
  return await res.json();
}

// TextDecoder silently eats a leading BOM, which is exactly what this file has
// to assert is present.
function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8');
}

function imagesOf(task: ProjectExport['tasks'][number]) {
  return task.attachments.filter((attachment) => attachment.kind === 'image');
}

// An image entry always names the archive path its bytes are packed at; the
// manifest types path as nullable because link attachments carry no file.
function archivePath(image: { path: string | null }): string {
  if (image.path === null) {
    throw new Error('export image entry has no archive path');
  }
  return image.path;
}

// A manifest entry with no file names bytes the archive does not carry; a file
// with no entry is bytes nothing in the manifest can attribute.
function expectBytesAgree(manifest: ProjectExport, files: Record<string, Uint8Array>): void {
  const listed = manifest.tasks.flatMap((task) =>
    task.attachments.flatMap((attachment) => (attachment.path === null ? [] : [attachment.path]))
  );
  const packed = Object.keys(files).filter((name) => name.startsWith('attachments/'));
  expect(listed.sort()).toEqual(packed.sort());
}

async function exportZip(
  projectId: string,
  token: string
): Promise<{ response: Response; files: Record<string, Uint8Array> }> {
  const response = await ctx.request(token).get(`/api/projects/${projectId}/export`);
  expect(response.status).toBe(200);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  return { response, files };
}

// UUIDs never collide with other content, so a textual substitution is enough
// to rewrite every reference — including the ones inside descriptions.
function remapIds<T>(value: T, idMap: Map<string, string>): T {
  let json = JSON.stringify(value);
  for (const [oldId, replacement] of idMap) {
    json = json.split(oldId).join(replacement);
  }
  return JSON.parse(json);
}

function canonicalize(exportPayload: ProjectExport): unknown {
  return {
    format: exportPayload.format,
    version: exportPayload.version,
    project: {
      id: exportPayload.project.id,
      name: exportPayload.project.name,
      description: exportPayload.project.description,
      archived_at: exportPayload.project.archived_at,
      created_by: exportPayload.project.created_by,
      member_ids: [...exportPayload.project.member_ids].sort(),
      is_public: exportPayload.project.is_public,
      color: exportPayload.project.color,
    },
    users: exportPayload.users,
    columns: exportPayload.columns,
    labels: exportPayload.labels,
    tasks: exportPayload.tasks.map((task) => ({
      id: task.id,
      column_id: task.column_id,
      title: task.title,
      description: task.description,
      sort_key: task.sort_key,
      due_date: task.due_date,
      archived_at: task.archived_at,
      label_ids: [...task.label_ids].sort(),
      assignee_ids: [...task.assignee_ids].sort(),
      blocker_ids: [...task.blocker_ids].sort(),
      cover_image_url: task.cover_image_url,
      images: [...imagesOf(task)]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((image) => ({
          id: image.id,
          path: image.path,
          filename: image.filename,
          content_type: image.content_type,
          size_bytes: image.size_bytes,
        })),
    })),
  };
}

// Rebuilds a project from an export using nothing but the public API — the
// standing proof that the manifest carries everything an importer needs.
async function reimport(
  user: TestUser,
  exportPayload: ProjectExport,
  files: Record<string, Uint8Array>
): Promise<{ projectId: string; idMap: Map<string, string> }> {
  const client = ctx.request(user.token);
  const idMap = new Map<string, string>();
  const projectId = await createProject(user, exportPayload.project.name);
  idMap.set(exportPayload.project.id, projectId);

  if (exportPayload.project.description !== '') {
    const res = await client.patch(`/api/projects/${projectId}`, {
      description: exportPayload.project.description,
    });
    expect(res.status).toBe(200);
  }
  if (exportPayload.project.color !== null) {
    const res = await client.patch(`/api/projects/${projectId}`, {
      color: exportPayload.project.color,
    });
    expect(res.status).toBe(200);
  }
  if (exportPayload.project.member_ids.length > 0) {
    const res = await client.put(`/api/projects/${projectId}/members`, {
      user_ids: exportPayload.project.member_ids,
    });
    expect(res.status).toBe(204);
  }

  for (const column of await columnsOf(projectId, user.token)) {
    expect((await client.delete(`/api/columns/${column.id}`)).status).toBe(204);
  }
  for (const column of exportPayload.columns) {
    idMap.set(column.id, newId());
    const res = await client.post('/api/columns', {
      id: idMap.get(column.id),
      project_id: projectId,
      name: column.name,
      sort_key: column.sort_key,
      is_done: column.is_done,
    });
    expect(res.status).toBe(201);
  }

  for (const label of exportPayload.labels) {
    idMap.set(label.id, newId());
    const res = await client.post('/api/labels', {
      id: idMap.get(label.id),
      project_id: projectId,
      name: label.name,
      color: label.color,
    });
    expect(res.status).toBe(201);
  }

  // Image ids are minted before the tasks so descriptions can be rewritten to
  // point at the images this import is about to upload.
  for (const task of exportPayload.tasks) {
    for (const image of imagesOf(task)) {
      idMap.set(image.id, newId());
    }
    idMap.set(task.id, newId());
  }

  for (const task of exportPayload.tasks) {
    const res = await client.post('/api/tasks', {
      id: idMap.get(task.id),
      project_id: projectId,
      column_id: idMap.get(task.column_id),
      title: task.title,
      description: task.description === null ? null : remapIds(task.description, idMap),
      sort_key: task.sort_key,
      due_date: task.due_date,
      label_ids: task.label_ids.map((labelId) => idMap.get(labelId)),
      assignee_ids: task.assignee_ids,
    });
    expect(res.status).toBe(201);
  }

  for (const task of exportPayload.tasks) {
    for (const image of imagesOf(task)) {
      const bytes = files[archivePath(image)];
      expect(bytes).toBeDefined();
      const res = await client.postBytes(
        uploadPath(idMap.get(task.id) as string, {
          filename: image.filename ?? 'image.png',
          id: idMap.get(image.id) as string,
        }),
        Buffer.from(bytes)
      );
      expect(res.status).toBe(201);
    }
    const cover = imagesOf(task).find((image) => task.cover_image_url?.endsWith(image.id));
    if (cover) {
      const res = await client.put(`/api/tasks/${idMap.get(task.id)}/cover`, {
        image_id: idMap.get(cover.id),
      });
      expect(res.status).toBe(204);
    }
    for (const blockerId of task.blocker_ids) {
      const res = await client.post(`/api/tasks/${idMap.get(task.id)}/blockers`, {
        blocker_task_id: idMap.get(blockerId),
      });
      expect(res.status).toBe(204);
    }
  }

  return { projectId, idMap };
}

describe('GET /api/projects/:id/export', () => {
  let owner: TestUser;
  let member: TestUser;
  let stranger: TestUser;
  let exMember: TestUser;
  let projectId: string;
  let backlogId: string;
  let doneId: string;
  let blockerTaskId: string;
  let mainTaskId: string;
  let doneTaskId: string;
  let bugLabelId: string;
  let uiLabelId: string;
  let pngImageId: string;
  let jpegImageId: string;
  let description: TiptapDoc;

  beforeAll(async () => {
    owner = await ctx.createUser('export-owner');
    member = await ctx.createUser('export-member');
    stranger = await ctx.createUser('export-stranger');
    exMember = await ctx.createUser('export-ex-member');
    const client = ctx.request(owner.token);

    projectId = await createProject(owner, 'My Project! 🎉');
    expect((await client.patch(`/api/projects/${projectId}`, { color: 'violet' })).status).toBe(
      200
    );
    expect(
      (
        await client.put(`/api/projects/${projectId}/members`, {
          user_ids: [member.id, exMember.id],
        })
      ).status
    ).toBe(204);

    const columns = await columnsOf(projectId, owner.token);
    backlogId = columns[0].id;
    doneId = columns[columns.length - 1].id;

    bugLabelId = newId();
    uiLabelId = newId();
    for (const [id, name, color] of [
      [bugLabelId, 'bug', '#ff0000'],
      [uiLabelId, 'ui', '#00ff00'],
    ]) {
      const res = await client.post('/api/labels', { id, project_id: projectId, name, color });
      expect(res.status).toBe(201);
    }

    blockerTaskId = newId();
    mainTaskId = newId();
    doneTaskId = newId();
    expect(
      (
        await client.post('/api/tasks', {
          id: blockerTaskId,
          project_id: projectId,
          column_id: backlogId,
          title: 'Blocker task',
          sort_key: rankKey(1000),
        })
      ).status
    ).toBe(201);
    expect(
      (
        await client.post('/api/tasks', {
          id: mainTaskId,
          project_id: projectId,
          column_id: backlogId,
          title: 'He said "hi", then\nleft',
          sort_key: rankKey(2000),
          due_date: '2026-08-03',
          label_ids: [bugLabelId, uiLabelId],
          assignee_ids: [owner.id, member.id],
        })
      ).status
    ).toBe(201);
    expect(
      (
        await client.post('/api/tasks', {
          id: doneTaskId,
          project_id: projectId,
          column_id: doneId,
          title: 'Finished',
          sort_key: rankKey(3000),
          assignee_ids: [exMember.id],
        })
      ).status
    ).toBe(201);
    expect(
      (
        await client.post(`/api/tasks/${mainTaskId}/blockers`, {
          blocker_task_id: blockerTaskId,
        })
      ).status
    ).toBe(204);

    pngImageId = newId();
    jpegImageId = newId();
    expect(
      (
        await client.postBytes(
          uploadPath(mainTaskId, { filename: 'pixel.png', id: pngImageId }),
          PNG_1X1
        )
      ).status
    ).toBe(201);
    expect(
      (
        await client.postBytes(
          uploadPath(mainTaskId, { filename: 'photo.jpg', id: jpegImageId }),
          JPEG_1X1
        )
      ).status
    ).toBe(201);
    // The jpeg: a cover no description embeds is only restorable from cover_image_url.
    expect(
      (await client.put(`/api/tasks/${mainTaskId}/cover`, { image_id: jpegImageId })).status
    ).toBe(204);

    description = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Notes' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'A paragraph.' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
        { type: 'image', attrs: { src: `/api/images/${pngImageId}` } },
      ],
    };
    expect((await client.patch(`/api/tasks/${mainTaskId}`, { description })).status).toBe(200);

    // Removing a member through the API also strips their assignments, so the
    // orphaned-assignee state has to be written directly.
    await db
      .deleteFrom('project_member')
      .where('project_id', '=', projectId)
      .where('user_id', '=', exMember.id)
      .execute();
  });

  afterAll(async () => {
    if (createdProjectIds.length > 0) {
      const rows = await db
        .selectFrom('task_attachment')
        .innerJoin('task', 'task.id', 'task_attachment.task_id')
        .select('task_attachment.image_storage_key as storage_key')
        .where('task_attachment.kind', '=', 'image')
        .where('task.project_id', 'in', createdProjectIds)
        .execute();
      await Promise.all(
        rows.map((row) =>
          fs.rm(path.join(env.storageDiskRoot, imageStorageKey(row.storage_key)), { force: true })
        )
      );
      await db.deleteFrom('project').where('id', 'in', createdProjectIds).execute();
    }
    await ctx.cleanup();
  });

  describe('format=json', () => {
    it('returns a versioned envelope with the project, columns, labels and tasks', async () => {
      const exportPayload = await exportJson(projectId, owner.token);

      expect(exportPayload.format).toBe('critical-path-project-export');
      expect(exportPayload.version).toBe(4);
      expect(Number.isNaN(Date.parse(exportPayload.exported_at))).toBe(false);

      const board = await (await ctx.request(owner.token).get(`/api/projects/${projectId}`)).json();
      expect(exportPayload.project).toEqual(board.project);
      expect(exportPayload.project.color).toBe('violet');
      expect(exportPayload.columns).toEqual(board.columns);
      expect(exportPayload.labels.map((label) => label.name)).toEqual(['bug', 'ui']);
      expect(exportPayload.tasks.map((task) => task.sort_key)).toEqual(
        [...exportPayload.tasks.map((task) => task.sort_key)].sort()
      );

      const main = exportPayload.tasks[1];
      expect(main.due_date).toBe('2026-08-03');
      expect(exportPayload.tasks[0].due_date).toBeNull();
      expect(main.label_ids).toEqual([bugLabelId, uiLabelId].sort());
      expect(main.assignee_ids).toEqual([owner.id, member.id].sort());
      expect(main.blocker_ids).toEqual([blockerTaskId]);
      expect(main.cover_image_url).toBe(`/api/images/${jpegImageId}`);
      expect(imagesOf(main).map((image) => image.id)).toContain(jpegImageId);
      expect(exportPayload.tasks[0].cover_image_url).toBeNull();
      expect(main).not.toHaveProperty('image_count');
    });

    it('lists every image by archive path and never leaks a storage key', async () => {
      const res = await ctx
        .request(owner.token)
        .get(`/api/projects/${projectId}/export?format=json`);
      const body = await res.text();
      const exportPayload: ProjectExport = JSON.parse(body);

      const images = exportPayload.tasks.flatMap((task) => imagesOf(task));
      expect(images).toHaveLength(2);
      expect(images.find((image) => image.id === pngImageId)).toEqual({
        id: pngImageId,
        kind: 'image',
        is_cover: false,
        path: `attachments/${pngImageId}.png`,
        title: null,
        description: null,
        filename: 'pixel.png',
        content_type: 'image/png',
        size_bytes: PNG_1X1.length,
        url: null,
        unfurl_state: null,
        created_at: expect.any(String),
      });
      expect(images.find((image) => image.id === jpegImageId)?.path).toBe(
        `attachments/${jpegImageId}.jpg`
      );
      expect(imagesOf(exportPayload.tasks[0])).toEqual([]);

      const storageKeys = await db
        .selectFrom('task_attachment')
        .innerJoin('task', 'task.id', 'task_attachment.task_id')
        .select('task_attachment.image_storage_key as storage_key')
        .where('task_attachment.kind', '=', 'image')
        .where('task.project_id', '=', projectId)
        .execute();
      expect(storageKeys).toHaveLength(2);
      expect(body).not.toContain('storage_key');
      for (const row of storageKeys) {
        expect(body).not.toContain(row.storage_key);
      }
    });

    it('resolves every user reference without exposing avatar urls or addresses', async () => {
      const exportPayload = await exportJson(projectId, owner.token);

      const byId = new Map(exportPayload.users.map((user) => [user.id, user]));
      expect(byId.get(owner.id)).toEqual({ id: owner.id, name: owner.name });
      expect(byId.has(member.id)).toBe(true);
      expect(byId.has(exMember.id)).toBe(true);
      for (const user of exportPayload.users) {
        expect(Object.keys(user).sort()).toEqual(['id', 'name']);
      }
      const serialized = JSON.stringify(exportPayload);
      for (const address of [owner.email, member.email, exMember.email]) {
        expect(serialized).not.toContain(address);
      }

      expect(byId.has(exportPayload.project.created_by as string)).toBe(true);
      for (const id of exportPayload.project.member_ids) {
        expect(byId.has(id)).toBe(true);
      }
      for (const task of exportPayload.tasks) {
        for (const id of task.assignee_ids) {
          expect(byId.has(id)).toBe(true);
        }
      }
    });

    it('keeps description image sources byte-identical and resolvable', async () => {
      const exportPayload = await exportJson(projectId, owner.token);
      const main = exportPayload.tasks[1];

      expect(main.description).toEqual(description);
      expect(JSON.stringify(main.description)).toContain(`/api/images/${pngImageId}`);
      expect(imagesOf(main).some((image) => image.id === pngImageId)).toBe(true);
    });
  });

  describe('zip archive', () => {
    // The date comes from the manifest the same request produced, not from a
    // second reading of the clock here: the route stamps both from one `new
    // Date()`, so comparing against a locally computed today would disagree with
    // it for the few milliseconds a day that straddle midnight UTC.
    it('serves an attachment named after the project with an ASCII slug and the export date', async () => {
      const { response, files } = await exportZip(projectId, owner.token);

      expect(response.headers.get('content-type')).toBe('application/zip');
      expect(response.headers.get('cache-control')).toBe('no-store');
      const manifest = JSON.parse(decode(files['project.json'])) as ProjectExport;
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="my-project-${manifest.exported_at.slice(0, 10)}.zip"`
      );
    });

    it('holds the manifest, the csv, and the real bytes of every image', async () => {
      const { files } = await exportZip(projectId, owner.token);

      expect(Object.keys(files).sort()).toEqual(
        [
          'project.json',
          'tasks.csv',
          `attachments/${pngImageId}.png`,
          `attachments/${jpegImageId}.jpg`,
        ].sort()
      );
      expect(Buffer.from(files[`attachments/${pngImageId}.png`])).toEqual(PNG_1X1);
      expect(Buffer.from(files[`attachments/${jpegImageId}.jpg`])).toEqual(JPEG_1X1);
      expectBytesAgree(await exportJson(projectId, owner.token), files);
    });

    it('packages the same manifest the json format returns', async () => {
      const { files } = await exportZip(projectId, owner.token);
      const fromZip = JSON.parse(decode(files['project.json'])) as ProjectExport;
      const fromJson = await exportJson(projectId, owner.token);

      expect(fromZip.exported_at).toBeTypeOf('string');
      delete (fromZip as Partial<ProjectExport>).exported_at;
      delete (fromJson as Partial<ProjectExport>).exported_at;
      expect(fromZip).toEqual(fromJson);
    });

    it('writes a spreadsheet-ready csv with one row per task', async () => {
      const { files } = await exportZip(projectId, owner.token);
      const exportPayload = await exportJson(projectId, owner.token);
      const csv = decode(files['tasks.csv']);

      expect(csv.startsWith('\ufeff')).toBe(true);
      expect(csv.endsWith('\r\n')).toBe(true);

      const rows = csv.slice(1).split('\r\n');
      expect(rows.filter(Boolean)).toHaveLength(4);
      expect(rows[0]).toBe(CSV_HEADER);

      const [blocker, main, done] = exportPayload.tasks;
      expect(rows[1]).toBe(
        `${blocker.id},Blocker task,Backlog,false,1,,,,,0,0,` +
          `${blocker.created_at},${blocker.updated_at},,,`
      );
      // Assignee names follow the users[] order, which is by name, so
      // "export-member user" precedes "export-owner user".
      expect(rows[2]).toBe(
        `${main.id},"He said ""hi"", then\nleft",Backlog,false,2,2026-08-03,bug; ui,` +
          `${member.name}; ${owner.name},Blocker task,2,2,` +
          `${main.created_at},${main.updated_at},,,"Notes\nA paragraph.\none\ntwo"`
      );
      expect(rows[3]).toBe(
        `${done.id},Finished,Done,true,3,,,${exMember.name},,0,0,` +
          `${done.created_at},${done.updated_at},,,`
      );
    });

    it('still produces a readable archive when a storage object is missing', async () => {
      const orphanProjectId = await createProject(owner, 'Orphaned image project');
      const columns = await columnsOf(orphanProjectId, owner.token);
      const taskId = newId();
      expect(
        (
          await ctx.request(owner.token).post('/api/tasks', {
            id: taskId,
            project_id: orphanProjectId,
            column_id: columns[0].id,
            title: 'Task with a lost image',
            sort_key: rankKey(1000),
          })
        ).status
      ).toBe(201);
      const { imageId } = await insertTaskImage({ taskId });

      const { files } = await exportZip(orphanProjectId, owner.token);
      const manifest = JSON.parse(decode(files['project.json'])) as ProjectExport;

      expect(imagesOf(manifest.tasks[0]).map((image) => image.id)).toEqual([imageId]);
      expect(Object.keys(files).sort()).toEqual(['project.json', 'tasks.csv']);
    });

    it('exports an empty project as a manifest plus a header-only csv', async () => {
      const emptyProjectId = await createProject(owner, 'Empty');

      const { files } = await exportZip(emptyProjectId, owner.token);
      const manifest = JSON.parse(decode(files['project.json'])) as ProjectExport;

      expect(Object.keys(files).sort()).toEqual(['project.json', 'tasks.csv']);
      expect(manifest.tasks).toEqual([]);
      expect(manifest.labels).toEqual([]);
      expect(manifest.columns).toHaveLength(4);
      expect(decode(files['tasks.csv'])).toBe(`\ufeff${CSV_HEADER}\r\n`);
    });

    it('refuses to write an archive that would overflow the 32-bit zip fields', async () => {
      const hugeProjectId = await createProject(owner, 'Huge');
      const columns = await columnsOf(hugeProjectId, owner.token);
      const taskId = newId();
      expect(
        (
          await ctx.request(owner.token).post('/api/tasks', {
            id: taskId,
            project_id: hugeProjectId,
            column_id: columns[0].id,
            title: 'Enormous',
            sort_key: rankKey(1000),
          })
        ).status
      ).toBe(201);
      for (let i = 0; i < 3; i++) {
        const id = newId();
        const storageKey = newId();
        await insertTaskImages(db, [
          {
            id,
            task_id: taskId,
            storage_key: storageKey,
            filename: `huge-${i}.png`,
            content_type: 'image/png',
            size_bytes: 2_000_000_000,
            is_cover: false,
          },
        ]);
      }

      const res = await ctx.request(owner.token).get(`/api/projects/${hugeProjectId}/export`);
      expect(res.status).toBe(413);
      expect((await res.json()).error).toContain('format=json');

      const jsonRes = await ctx
        .request(owner.token)
        .get(`/api/projects/${hugeProjectId}/export?format=json`);
      expect(jsonRes.status).toBe(200);
    });
  });

  describe('archived tasks', () => {
    let archiveProjectId: string;
    let archiveColumnId: string;
    let liveTaskId: string;
    let archivedTaskId: string;
    let liveImageId: string;
    let archivedImageId: string;
    let archivedAt: string;

    beforeAll(async () => {
      const client = ctx.request(owner.token);
      archiveProjectId = await createProject(owner, 'Archive export');
      archiveColumnId = (await columnsOf(archiveProjectId, owner.token))[0].id;

      liveTaskId = newId();
      archivedTaskId = newId();
      for (const [id, title, position] of [
        [liveTaskId, 'Stays visible', 1000],
        [archivedTaskId, 'Shelved work', 2000],
      ] as const) {
        expect(
          (
            await client.post('/api/tasks', {
              id,
              project_id: archiveProjectId,
              column_id: archiveColumnId,
              title,
              sort_key: rankKey(position),
            })
          ).status
        ).toBe(201);
      }

      liveImageId = newId();
      archivedImageId = newId();
      expect(
        (
          await client.postBytes(
            uploadPath(liveTaskId, { filename: 'live.png', id: liveImageId }),
            PNG_1X1
          )
        ).status
      ).toBe(201);
      expect(
        (
          await client.postBytes(
            uploadPath(archivedTaskId, { filename: 'shelved.jpg', id: archivedImageId }),
            JPEG_1X1
          )
        ).status
      ).toBe(201);

      const res = await client.post(`/api/tasks/${archivedTaskId}/archive`);
      expect(res.status).toBe(200);
      archivedAt = (await res.json()).archived_at;
    });

    it('exports an archived card marked with archived_at, after the live ones', async () => {
      const manifest = await exportJson(archiveProjectId, owner.token);

      expect(manifest.tasks.map((task) => task.id)).toEqual([liveTaskId, archivedTaskId]);
      const [live, archived] = manifest.tasks;
      expect(live.archived_at).toBeNull();
      expect(archived.archived_at).toBe(archivedAt);
      expect(archived.title).toBe('Shelved work');
    });

    it('keeps the column the card was archived from', async () => {
      const manifest = await exportJson(archiveProjectId, owner.token);
      const archived = manifest.tasks.find((task) => task.id === archivedTaskId);

      expect(archived?.column_id).toBe(archiveColumnId);
      expect(manifest.columns.map((column) => column.id)).toContain(archiveColumnId);
    });

    it('packs the image bytes of an archived card and lists them in the manifest', async () => {
      const manifest = await exportJson(archiveProjectId, owner.token);
      const { files } = await exportZip(archiveProjectId, owner.token);

      expectBytesAgree(manifest, files);
      expect(manifest.tasks.flatMap((task) => imagesOf(task).map((image) => image.id))).toEqual([
        liveImageId,
        archivedImageId,
      ]);
      expect(Object.keys(files).sort()).toEqual(
        [
          'project.json',
          'tasks.csv',
          `attachments/${liveImageId}.png`,
          `attachments/${archivedImageId}.jpg`,
        ].sort()
      );
      expect(Buffer.from(files[`attachments/${archivedImageId}.jpg`])).toEqual(JPEG_1X1);
    });

    it('writes the archived card into the csv with its timestamp', async () => {
      const { files } = await exportZip(archiveProjectId, owner.token);
      const rows = decode(files['tasks.csv']).slice(1).split('\r\n').filter(Boolean);

      expect(rows[0]).toBe(CSV_HEADER);
      expect(rows).toHaveLength(3);
      expect(rows[1]).toContain('Stays visible');
      expect(rows[1].endsWith(',,,')).toBe(true);
      expect(rows[2]).toContain('Shelved work');
      expect(rows[2].endsWith(`,${archivedAt},,`)).toBe(true);
    });
  });

  describe('round trip', () => {
    it('rebuilds an identical board from the archive alone', async () => {
      const original = await exportJson(projectId, owner.token);
      const { files } = await exportZip(projectId, owner.token);

      // The orphaned assignee has no project access, so a faithful import has
      // to re-add them as a member before it can restore the assignment.
      const importable: ProjectExport = {
        ...original,
        project: { ...original.project, member_ids: [member.id, exMember.id] },
      };

      const { projectId: copyId, idMap } = await reimport(owner, importable, files);
      const copy = await exportJson(copyId, owner.token);

      expect(canonicalize(copy)).toEqual(canonicalize(remapIds(importable, idMap)));

      // Equality alone would also hold if the manifest dropped a relation on
      // both sides, so pin what the rebuilt board must actually contain.
      expect(copy.columns).toHaveLength(4);
      expect(copy.labels.map((label) => label.name)).toEqual(['bug', 'ui']);
      expect(copy.tasks).toHaveLength(3);
      expect(copy.tasks.flatMap((task) => task.blocker_ids)).toHaveLength(1);
      expect(copy.tasks.flatMap((task) => task.assignee_ids)).toHaveLength(3);
      expect(copy.tasks.flatMap((task) => task.label_ids)).toHaveLength(2);

      const copiedImages = copy.tasks.flatMap((task) => imagesOf(task));
      expect(copiedImages).toHaveLength(2);
      expect(JSON.stringify(copy.tasks[1].description)).toContain(
        `/api/images/${copiedImages.find((image) => image.content_type === 'image/png')?.id}`
      );
      expect(copy.tasks[1].cover_image_url).toBe(
        `/api/images/${copiedImages.find((image) => image.content_type === 'image/jpeg')?.id}`
      );

      const copyZip = await exportZip(copyId, owner.token);
      for (const image of copiedImages) {
        expect(Buffer.from(copyZip.files[archivePath(image)])).toEqual(
          image.content_type === 'image/png' ? PNG_1X1 : JPEG_1X1
        );
      }
    });

    it('reproduces the same csv after a round trip', async () => {
      const original = await exportJson(projectId, owner.token);
      const { files } = await exportZip(projectId, owner.token);
      const importable: ProjectExport = {
        ...original,
        project: { ...original.project, member_ids: [member.id, exMember.id] },
      };

      const { projectId: copyId, idMap } = await reimport(owner, importable, files);
      const copyZip = await exportZip(copyId, owner.token);

      const stripVolatile = (csv: string): string[] =>
        csv.split('\r\n').map((line) => line.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'TIMESTAMP'));

      expect(stripVolatile(decode(copyZip.files['tasks.csv']))).toEqual(
        stripVolatile(remapIds(decode(files['tasks.csv']), idMap))
      );
    });
  });

  describe('access control and validation', () => {
    it('requires authentication', async () => {
      expect((await ctx.request().get(`/api/projects/${projectId}/export`)).status).toBe(401);
    });

    it('hides the project from users without access', async () => {
      expect(
        (await ctx.request(stranger.token).get(`/api/projects/${projectId}/export`)).status
      ).toBe(404);
      expect(
        (await ctx.request(stranger.token).get(`/api/projects/${projectId}/export?format=json`))
          .status
      ).toBe(404);
    });

    it('lets any project member export', async () => {
      const exportPayload = await exportJson(projectId, member.token);
      expect(exportPayload.project.id).toBe(projectId);
    });

    it('accepts an explicit format=zip', async () => {
      const res = await ctx
        .request(owner.token)
        .get(`/api/projects/${projectId}/export?format=zip`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
    });

    it('rejects an unknown format with 400', async () => {
      const res = await ctx
        .request(owner.token)
        .get(`/api/projects/${projectId}/export?format=xml`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTypeOf('string');
    });

    it('rejects a malformed project id with 400', async () => {
      expect((await ctx.request(owner.token).get('/api/projects/not-a-uuid/export')).status).toBe(
        400
      );
    });

    it('returns 404 for an unknown project', async () => {
      expect((await ctx.request(owner.token).get(`/api/projects/${newId()}/export`)).status).toBe(
        404
      );
    });

    it('still exports an archived project', async () => {
      const archivedProjectId = await createProject(owner, 'Archived');
      const archivedAt = new Date().toISOString();
      expect(
        (
          await ctx
            .request(owner.token)
            .patch(`/api/projects/${archivedProjectId}`, { archived_at: archivedAt })
        ).status
      ).toBe(200);

      const exportPayload = await exportJson(archivedProjectId, owner.token);
      expect(exportPayload.project.archived_at).toBe(archivedAt);
    });
  });
});
