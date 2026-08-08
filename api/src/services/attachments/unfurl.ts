import sharp from 'sharp';
import { sql } from 'kysely';
import { db } from '../../db/index';
import type { JsonValue } from '../../db/types';
import { errorText } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { registerJobHandler } from '../jobs/handlers';
import { publish } from '../realtime/bus';
import { enqueueDeliveries } from '../webhooks/queue';
import { targetPolicy, type TargetPolicy } from '../webhooks/targets';
import { sniffImageContentType } from '../imageSniff';
import { storage } from '../storage/index';
import { fetchAttachmentRow, toAttachmentResponse } from './index';
import { fetchVetted } from './unfurlFetch';
import { parseHeadMetadata, type HeadMetadata } from './unfurlParse';

export const ATTACHMENT_UNFURL_KIND = 'attachment_unfurl';

const TOTAL_BUDGET_MS = 12_000;
const HTML_BUDGET_MS = 6_000;
const IMAGE_BUDGET_MS = 5_000;
const HTML_MAX_BYTES = 512 * 1024;
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const FAVICON_MAX_BYTES = 256 * 1024;
const PREVIEW_DIMENSIONS = [1200, 630] as const;
const FAVICON_DIMENSIONS = [64, 64] as const;
const HTML_ACCEPT = ['text/html', 'application/xhtml+xml'];
const IMAGE_ACCEPT = ['image/'];

// https is not required even in production: the blocklist, not TLS, is the SSRF
// defence here, and refusing a pasted http:// link buys no security.
function unfurlPolicy(): TargetPolicy {
  return { allowPrivate: targetPolicy().allowPrivate, requireHttps: false };
}

async function storeImage(
  url: string,
  maxBytes: number,
  deadlineMs: number,
  dimensions: readonly [number, number]
): Promise<string | null> {
  if (deadlineMs <= 0) return null;
  try {
    const fetched = await fetchVetted(
      url,
      { maxBytes, deadlineMs, accept: IMAGE_ACCEPT },
      unfurlPolicy()
    );
    if (!sniffImageContentType(fetched.body)) return null;
    // Without the pixel cap a kilobyte-sized bomb decodes to gigabytes.
    const webp = await sharp(fetched.body, { autoOrient: true, limitInputPixels: 32_000_000 })
      .resize(dimensions[0], dimensions[1], { fit: 'inside', withoutEnlargement: true })
      .webp()
      .toBuffer();
    const key = crypto.randomUUID();
    await storage.put(key, webp, 'image/webp');
    return key;
  } catch {
    return null;
  }
}

async function reclaim(keys: (string | null)[]): Promise<void> {
  await Promise.all(
    keys
      .filter((key): key is string => key !== null)
      .map((key) =>
        storage.delete(key).catch((err: unknown) => {
          logger.error({
            msg: 'Failed to reclaim an unfurl image object',
            storageKey: key,
            error: errorText(err),
          });
        })
      )
  );
}

interface UnfurlOutcome {
  state: 'ok' | 'failed';
  meta: HeadMetadata;
  previewKey: string | null;
  faviconKey: string | null;
}

const NO_METADATA: HeadMetadata = {
  title: null,
  description: null,
  imageUrl: null,
  iconUrl: null,
};

const FAILED: UnfurlOutcome = {
  state: 'failed',
  meta: NO_METADATA,
  previewKey: null,
  faviconKey: null,
};

async function attempt(url: string): Promise<UnfurlOutcome> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  let page;
  try {
    page = await fetchVetted(
      url,
      {
        maxBytes: HTML_MAX_BYTES,
        deadlineMs: Math.min(HTML_BUDGET_MS, deadline - Date.now()),
        accept: HTML_ACCEPT,
      },
      unfurlPolicy()
    );
  } catch {
    return FAILED;
  }

  try {
    const meta = parseHeadMetadata(page.body, page.contentType, page.finalUrl);
    const imageBudget = Math.min(IMAGE_BUDGET_MS, deadline - Date.now());

    // Each image fails independently: a preview that 404s leaves that field null
    // rather than discarding the text metadata the page did give up.
    const [previewKey, faviconKey] = await Promise.all([
      meta.imageUrl === null
        ? Promise.resolve(null)
        : storeImage(meta.imageUrl, PREVIEW_MAX_BYTES, imageBudget, PREVIEW_DIMENSIONS),
      meta.iconUrl === null
        ? Promise.resolve(null)
        : storeImage(meta.iconUrl, FAVICON_MAX_BYTES, imageBudget, FAVICON_DIMENSIONS),
    ]);

    return { state: 'ok', meta, previewKey, faviconKey };
  } catch (err) {
    // Logged rather than rethrown: retrying a crash on the same bytes only ends
    // with the attempts exhausted and the row spinning at 'pending' for good.
    logger.error({
      msg: 'Unfurl failed while reading a fetched page',
      error: errorText(err),
    });
    return FAILED;
  }
}

// A network outcome is never a throw: a 403, a timeout, a non-HTML body or a
// blocked address all settle the row at 'failed' and report success, so it
// cannot sit at 'pending' behind six hours of backoff.
export async function runAttachmentUnfurl(attachmentId: string): Promise<void> {
  const row = await db
    .selectFrom('task_attachment')
    .innerJoin('task', 'task.id', 'task_attachment.task_id')
    .select(['task_attachment.url', 'task_attachment.unfurl_state', 'task.project_id'])
    .where('task_attachment.id', '=', attachmentId)
    .where('task_attachment.kind', '=', 'link')
    .executeTakeFirst();
  if (!row || row.url === null || row.unfurl_state !== 'pending') {
    return;
  }

  const outcome = await attempt(row.url);

  let updated;
  try {
    updated = await db
      .updateTable('task_attachment')
      .set({
        // A user who typed a title or description while the job was in flight
        // keeps what they typed.
        title: sql<string | null>`coalesce(task_attachment.title, ${outcome.meta.title})`,
        description: sql<
          string | null
        >`coalesce(task_attachment.description, ${outcome.meta.description})`,
        preview_storage_key: outcome.previewKey,
        favicon_storage_key: outcome.faviconKey,
        unfurl_state: outcome.state,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', attachmentId)
      // The runner re-invokes a handler whose lease lapsed while it was still
      // running, so exactly one of two concurrent runs may win this write.
      .where('unfurl_state', '=', 'pending')
      .executeTakeFirst();
  } catch (err) {
    await reclaim([outcome.previewKey, outcome.faviconKey]);
    throw err;
  }

  if (updated.numUpdatedRows === 0n) {
    await reclaim([outcome.previewKey, outcome.faviconKey]);
    return;
  }

  const fresh = await fetchAttachmentRow(db, attachmentId);
  if (!fresh) return;

  const data = toAttachmentResponse(fresh);
  // No request context outside a route, so publishAfterCommit is unavailable
  // and the webhook fan-out it normally performs has to be done by hand.
  publish({ type: 'attachment_updated', project_id: row.project_id, data });
  await enqueueDeliveries([{ type: 'attachment_updated', project_id: row.project_id, data }]);
}

export function registerAttachmentUnfurlHandler(): void {
  registerJobHandler({
    kind: ATTACHMENT_UNFURL_KIND,
    timeoutMs: 15_000,
    run: async (payload: JsonValue) => {
      const attachmentId =
        typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? payload.attachment_id
          : undefined;
      if (typeof attachmentId !== 'string') {
        throw new Error('attachment_unfurl payload needs an attachment_id');
      }
      await runAttachmentUnfurl(attachmentId);
    },
  });
}
