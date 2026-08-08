import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { describeRoute } from 'hono-openapi';
import { sql } from 'kysely';
import { env } from '../config/env';
import { optionalAuth } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator, queryValidator } from '../middleware/requestValidator';
import { enforceLinkAttachmentRateLimit } from '../middleware/rateLimit';
import { AppError, isUniqueViolation } from '../utils/errors';
import { assertTaskWrite } from '../services/authorization';
import { publishAfterCommit } from '../services/realtime/index';
import { storage } from '../services/storage/index';
import { deleteStoredObjectsAfterCommit } from '../services/storage/cleanup';
import { storedObjectResponse } from '../services/storage/response';
import { enqueueJob } from '../services/jobs/index';
import { logger } from '../utils/logger';
import {
  MAX_ATTACHMENTS_PER_TASK,
  ATTACHMENT_NOT_FOUND,
  assertAttachmentReadable,
  assertAttachmentWrite,
  countTaskAttachments,
  fetchAttachmentRow,
  toAttachmentResponse,
} from '../services/attachments/index';
import { assertProjectStorageQuota, projectStorageAllowance } from '../services/attachments/quota';
import {
  discardStoredUpload,
  storeSniffedUpload,
  UploadCapExceededError,
} from '../services/attachments/upload';
import {
  contentDispositionAttachment,
  sanitizeDeclaredContentType,
  sanitizeUploadFilename,
  DEFAULT_CONTENT_TYPE,
} from '../services/attachments/serve';
import { ATTACHMENT_UNFURL_KIND } from '../services/attachments/unfurl';
import { IMAGE_MAX_BYTES } from '../services/attachments/images';
import {
  idSchema,
  attachmentSchema,
  createLinkAttachmentSchema,
  patchAttachmentSchema,
  uploadAttachmentQuerySchema,
  jsonResponse,
  emptyResponse,
  rawResponse,
  type Returned,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  forbiddenErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  payloadTooLargeErrorResponse,
  tooManyRequestsErrorResponse,
  unprocessableErrorResponse,
  validationErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono, PublicHono } from '../types/index';

const router: AppHono = new Hono();

// The download, preview and favicon routes all serve with or without a token,
// which is a different context type, so they need their own router.
export const publicAttachmentsRouter: PublicHono = new Hono();

// The one guarantee that makes arbitrary uploads safe: user-supplied bytes are
// only ever handed back as an opaque download, never as something the browser
// may render, whatever the uploader declared.
function setDownloadHeaders(
  c: Parameters<MiddlewareHandler>[0],
  contentType: string,
  disposition?: string
): void {
  c.header('Content-Type', contentType);
  if (disposition !== undefined) {
    c.header('Content-Disposition', disposition);
  }
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', "default-src 'none'; sandbox");
  c.header('Cache-Control', 'private, max-age=31536000, immutable');
}

const createFileAttachmentResponses = {
  201: jsonResponse('Attachment created', attachmentSchema),
};

router.post(
  '/files',
  describeRoute({
    tags: ['Attachments'],
    summary: 'Upload a file attachment',
    description:
      'Attach a file of any type to a task. The request body is the file’s raw bytes and ' +
      'nothing else; `task_id`, an optional client-supplied `id`, the `filename` and the ' +
      'declared `content_type` travel as query parameters. The bytes are streamed straight to ' +
      'storage and never assembled in memory, so the per-file cap is enforced as they arrive ' +
      'and an upload that exceeds it is cut off mid-transfer with 413. The declared MIME type ' +
      'is recorded for display only and is never written to a response header: downloads are ' +
      'always served as application/octet-stream with an attachment Content-Disposition. A task ' +
      'holds at most 50 attachments, and the upload is refused with 413 when it would take the ' +
      'project past its storage quota, which counts image bytes too.',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
      },
    },
    responses: {
      ...createFileAttachmentResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...payloadTooLargeErrorResponse,
      ...unprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  queryValidator(uploadAttachmentQuerySchema),
  async (c): Promise<Returned<typeof createFileAttachmentResponses>> => {
    const db = c.get('db');
    const { task_id: taskId, id, filename, content_type: declaredType } = c.req.valid('query');

    const project = await assertTaskWrite(db, c.get('user').id, taskId);
    const attachmentId = id ?? crypto.randomUUID();

    if ((await countTaskAttachments(db, taskId)) >= MAX_ATTACHMENTS_PER_TASK) {
      throw new AppError(
        422,
        `A task holds at most ${String(MAX_ATTACHMENTS_PER_TASK)} attachments`
      );
    }

    const maxBytes = env.attachmentMaxBytes;
    const tooLarge = (limit: number): AppError =>
      new AppError(413, `File exceeds the ${String(limit)} byte limit`);

    const allowance = await projectStorageAllowance(db, project.id);
    // Whichever bound bites first is where the stream is cut, so an upload that
    // could never be stored stops arriving rather than being measured after.
    // Which byte cap applies is not known until the sniff, so the pre-flight
    // check below can only use the larger of the two.
    const capIsQuota = allowance.remaining < maxBytes;

    const declaredLength = Number(c.req.header('content-length'));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > Math.min(maxBytes, allowance.remaining)
    ) {
      throw capIsQuota ? allowance.exceeded() : tooLarge(maxBytes);
    }

    const body = c.req.raw.body;
    if (!body) {
      throw new AppError(422, 'File is empty');
    }

    let upload;
    try {
      upload = await storeSniffedUpload(
        body,
        {
          image: Math.min(IMAGE_MAX_BYTES, allowance.remaining),
          file: Math.min(maxBytes, allowance.remaining),
        },
        DEFAULT_CONTENT_TYPE
      );
    } catch (err) {
      if (err instanceof UploadCapExceededError) {
        throw capIsQuota ? allowance.exceeded() : tooLarge(maxBytes);
      }
      throw err;
    }
    const isImage = upload.imageContentType !== null;

    if (upload.size === 0) {
      await discardStoredUpload(upload.storageKey);
      throw new AppError(422, 'File is empty');
    }

    // The exact size exists only now, so the serialised check runs after the
    // write rather than before it — still before the row commits.
    try {
      await assertProjectStorageQuota(db, project.id, upload.size);
    } catch (err) {
      await discardStoredUpload(upload.storageKey);
      throw err;
    }

    let row;
    try {
      row = await db
        .insertInto('task_attachment')
        .values({
          id: attachmentId,
          task_id: taskId,
          kind: isImage ? 'image' : 'file',
          filename: sanitizeUploadFilename(filename || 'attachment'),
          size_bytes: upload.size,
          // The two shapes are exclusive, and which columns are filled is what
          // decides how the bytes may later be served.
          ...(isImage
            ? { image_storage_key: upload.storageKey, image_content_type: upload.imageContentType }
            : {
                storage_key: upload.storageKey,
                content_type: sanitizeDeclaredContentType(declaredType ?? ''),
              }),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      logger.warn({
        msg: 'Orphaned storage object: attachment row insert failed after storage write',
        storageKey: upload.storageKey,
        taskId,
      });
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Attachment id already in use');
      }
      throw err;
    }

    const attachment = toAttachmentResponse(row);
    publishAfterCommit(c, 'attachment_created', project.id, {
      ...attachment,
      attachment_count: await countTaskAttachments(db, taskId),
    });
    return c.json(attachment, 201);
  }
);

const createLinkAttachmentResponses = {
  201: jsonResponse('Attachment created', attachmentSchema),
};

router.post(
  '/links',
  describeRoute({
    tags: ['Attachments'],
    summary: 'Attach a link',
    description:
      'Attach a URL to a task. Answers 201 immediately with unfurl_state "pending"; a background ' +
      'job then fetches the page title, description, preview image and favicon and publishes ' +
      'attachment_updated. Unfurling never blocks the add and never fails it: a target that ' +
      'refuses, times out, or resolves to a private address settles the row at "failed" with the ' +
      'URL intact, and the title can be supplied by hand. Only http and https URLs are stored, ' +
      'and never one carrying credentials.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...createLinkAttachmentResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...tooManyRequestsErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(createLinkAttachmentSchema),
  async (c): Promise<Returned<typeof createLinkAttachmentResponses>> => {
    const { id, task_id, url, title } = c.req.valid('json');
    const db = c.get('db');
    const userId = c.get('user').id;

    const project = await assertTaskWrite(db, userId, task_id);
    await enforceLinkAttachmentRateLimit(userId);

    if ((await countTaskAttachments(db, task_id)) >= MAX_ATTACHMENTS_PER_TASK) {
      throw new AppError(
        422,
        `A task holds at most ${String(MAX_ATTACHMENTS_PER_TASK)} attachments`
      );
    }

    let row;
    try {
      row = await db
        .insertInto('task_attachment')
        .values({
          id,
          task_id,
          kind: 'link',
          url,
          title: title ?? null,
          unfurl_state: 'pending',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Attachment id already in use');
      }
      throw err;
    }

    // On the request transaction, so the job commits with the row or not at all.
    // Ids only: the queue refuses a payload carrying anything email-shaped, which
    // many legitimate URLs are, so the handler re-reads the URL from the row.
    await enqueueJob(db, ATTACHMENT_UNFURL_KIND, { attachment_id: id });

    const attachment = toAttachmentResponse(row);
    publishAfterCommit(c, 'attachment_created', project.id, {
      ...attachment,
      attachment_count: await countTaskAttachments(db, task_id),
    });
    return c.json(attachment, 201);
  }
);

const patchAttachmentResponses = {
  200: jsonResponse('Updated attachment', attachmentSchema),
};

router.patch(
  '/:id',
  describeRoute({
    tags: ['Attachments'],
    summary: 'Rename an attachment',
    description:
      'Set the display title or description. Both fields are optional and an empty body changes ' +
      'nothing. A file attachment’s filename is immutable and is not touched, so a rename can ' +
      'never change what a download saves as. The parent task’s updated_at is never touched, so ' +
      'an attachment edit cannot invalidate an open editor’s optimistic-concurrency precondition.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...patchAttachmentResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(patchAttachmentSchema),
  async (c): Promise<Returned<typeof patchAttachmentResponses>> => {
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    const db = c.get('db');

    const project = await assertAttachmentWrite(db, c.get('user').id, id);

    const changes = {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
    };

    if (Object.keys(changes).length > 0) {
      await db
        .updateTable('task_attachment')
        .set({ ...changes, updated_at: sql<Date>`now()` })
        .where('task_attachment.id', '=', id)
        .execute();
    }

    const row = await fetchAttachmentRow(db, id);
    if (!row) {
      throw new AppError(404, ATTACHMENT_NOT_FOUND);
    }

    const attachment = toAttachmentResponse(row);
    publishAfterCommit(c, 'attachment_updated', project.id, attachment);
    return c.json(attachment, 200);
  }
);

const deleteAttachmentResponses = { 204: emptyResponse('Attachment deleted') };

router.delete(
  '/:id',
  describeRoute({
    tags: ['Attachments'],
    summary: 'Delete an attachment',
    description:
      'Remove one attachment. Stored file, preview and favicon objects are reclaimed after the ' +
      'transaction commits. Deleting it twice returns 404.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...deleteAttachmentResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof deleteAttachmentResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');

    const project = await assertAttachmentWrite(db, c.get('user').id, id);

    const deleted = await db
      .deleteFrom('task_attachment')
      .where('task_attachment.id', '=', id)
      .returning([
        'task_attachment.task_id',
        'task_attachment.storage_key',
        'task_attachment.preview_storage_key',
        'task_attachment.favicon_storage_key',
      ])
      .executeTakeFirst();
    if (!deleted) {
      throw new AppError(404, ATTACHMENT_NOT_FOUND);
    }

    const keys = [
      deleted.storage_key,
      deleted.preview_storage_key,
      deleted.favicon_storage_key,
    ].filter((key): key is string => key !== null);
    deleteStoredObjectsAfterCommit(c, keys);

    // The cover lives on the row, so deleting one can clear it. Reported here
    // because this is now the only event that says an attachment went away.
    const cover = await db
      .selectFrom('task_attachment')
      .select('task_attachment.id')
      .where('task_attachment.task_id', '=', deleted.task_id)
      .where('task_attachment.is_cover', '=', true)
      .executeTakeFirst();
    publishAfterCommit(c, 'attachment_deleted', project.id, {
      id,
      task_id: deleted.task_id,
      attachment_count: await countTaskAttachments(db, deleted.task_id),
      cover_image_url: cover === undefined ? null : `/api/images/${cover.id}`,
    });
    return c.body(null, 204);
  }
);

const downloadAttachmentResponses = {
  200: rawResponse({
    description: 'Attachment bytes, always application/octet-stream',
    content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
  }),
};

// Optional auth, not public: on a private board this still answers only to a
// member, and only a published one serves a stranger.
publicAttachmentsRouter.get(
  '/:id/download',
  describeRoute({
    tags: ['Attachments'],
    summary: 'Download a file attachment',
    description:
      'Serve the stored bytes. On a private board this route is authenticated and answers 404 to ' +
      'anyone without project access, so a spec or a contract stops being readable the moment ' +
      'someone is removed from the project. On a published board it serves anyone, because a ' +
      'public board publishes its attachments. The response is always application/octet-stream with ' +
      'an attachment Content-Disposition, nosniff and a sandbox CSP, whatever the file is — no ' +
      'user-supplied bytes are ever served with a renderable content type. A link attachment ' +
      'answers 404.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...downloadAttachmentResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  optionalAuth,
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof downloadAttachmentResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');

    await assertAttachmentReadable(db, c.get('user'), id);

    const row = await db
      .selectFrom('task_attachment')
      .select(['task_attachment.storage_key', 'task_attachment.filename'])
      .where('task_attachment.id', '=', id)
      .where('task_attachment.kind', '=', 'file')
      .executeTakeFirst();
    if (!row || row.storage_key === null || row.filename === null) {
      throw new AppError(404, ATTACHMENT_NOT_FOUND);
    }

    const object = await storage.getStream(row.storage_key);
    if (!object) {
      logger.error({
        msg: 'Attachment row exists but storage object is missing',
        attachmentId: id,
        storageKey: row.storage_key,
      });
      throw new AppError(404, ATTACHMENT_NOT_FOUND);
    }

    setDownloadHeaders(c, DEFAULT_CONTENT_TYPE, contentDispositionAttachment(row.filename));
    return storedObjectResponse(c, object);
  }
);

const imageBytesResponses = {
  200: rawResponse({
    description: 'WebP image bytes',
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  }),
};

// Selects only its own key column, never storage_key, so the endpoint is
// structurally incapable of serving a document's bytes whatever id is guessed.
function imageServingRoute(
  segment: 'preview' | 'favicon',
  column: 'preview_storage_key' | 'favicon_storage_key',
  summary: string,
  description: string
): void {
  publicAttachmentsRouter.get(
    `/:id/${segment}`,
    describeRoute({
      tags: ['Attachments'],
      summary,
      description,
      responses: {
        ...imageBytesResponses,
        ...badRequestErrorResponse,
        ...notFoundErrorResponse,
        ...internalServerErrorResponse,
      },
    }),
    optionalAuth,
    paramValidator(idSchema),
    async (c): Promise<Returned<typeof imageBytesResponses>> => {
      const { id } = c.req.valid('param');

      await assertAttachmentReadable(c.get('db'), c.get('user'), id);

      const row = await c
        .get('db')
        .selectFrom('task_attachment')
        .select(`task_attachment.${column}`)
        .where('task_attachment.id', '=', id)
        .executeTakeFirst();
      const key = row?.[column] ?? null;
      if (key === null) {
        throw new AppError(404, ATTACHMENT_NOT_FOUND);
      }

      const object = await storage.getStream(key);
      if (!object) {
        logger.error({
          msg: 'Attachment image key is set but the storage object is missing',
          attachmentId: id,
          storageKey: key,
        });
        throw new AppError(404, ATTACHMENT_NOT_FOUND);
      }

      setDownloadHeaders(c, 'image/webp');
      return storedObjectResponse(c, object);
    }
  );
}

imageServingRoute(
  'preview',
  'preview_storage_key',
  'Get a link preview image',
  'Serve the preview image fetched for a link attachment, re-encoded to WebP at unfurl time. ' +
    'Unauthenticated: the unguessable attachment id acts as a capability URL so <img> tags work ' +
    'without auth headers. 404 when the link has no stored preview.'
);

imageServingRoute(
  'favicon',
  'favicon_storage_key',
  'Get a link favicon',
  'Serve the favicon fetched for a link attachment, re-encoded to WebP at unfurl time. ' +
    'Unauthenticated for the same reason as the preview. 404 when the link has no stored favicon.'
);

export default router;
