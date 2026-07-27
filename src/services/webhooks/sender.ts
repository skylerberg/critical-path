import http from 'node:http';
import https from 'node:https';
import { APP_NAME } from '../../config/constants';
import { MAX_ERROR_BODY_BYTES, SEND_TIMEOUT_MS, type DeliveryRow } from './queue';
import { signWebhookBody } from './signature';
import {
  assertRegistrableWebhookUrl,
  blockedTargetLookup,
  type LookupAll,
  type TargetPolicy,
} from './targets';

export interface SendResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
}

export interface SendDeliveryOptions {
  url: string;
  secret: string;
  webhookId: string;
  delivery: DeliveryRow;
  policy: TargetPolicy;
  resolve?: LookupAll;
}

const USER_AGENT = `${APP_NAME.replace(/\s+/g, '')}-Webhook/1`;

// node:http request() rather than fetch: only it takes the `lookup` option that
// pins the connection to the vetted address, and it does not follow redirects,
// which closes the redirect-to-metadata hole.
export function sendDelivery(options: SendDeliveryOptions): Promise<SendResult> {
  const { url, secret, webhookId, delivery, policy, resolve } = options;

  // Re-checked at send time because Node skips a custom lookup for IP literals,
  // and because a row can predate a policy change.
  try {
    assertRegistrableWebhookUrl(url, policy);
  } catch (err) {
    return Promise.resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }

  const target = new URL(url);
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const transport = target.protocol === 'https:' ? https : http;

  return new Promise<SendResult>((resolve_) => {
    let settled = false;
    const settle = (result: SendResult): void => {
      if (settled) return;
      settled = true;
      resolve_(result);
    };

    const request = transport.request(
      target,
      {
        method: 'POST',
        // The global agent keeps sockets alive and reuses them by host:port,
        // which skips the lookup entirely on every delivery after the first.
        agent: false,
        lookup: blockedTargetLookup(policy, resolve),
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': USER_AGENT,
          'X-Critical-Path-Event': delivery.event_type,
          'X-Critical-Path-Delivery': delivery.id,
          'X-Critical-Path-Webhook': webhookId,
          'X-Critical-Path-Timestamp': String(timestamp),
          'X-Critical-Path-Signature': `v1=${signWebhookBody(secret, timestamp, body)}`,
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          if (received < MAX_ERROR_BODY_BYTES) {
            chunks.push(chunk);
            received += chunk.length;
          }
        });
        response.on('end', () => {
          if (statusCode >= 200 && statusCode < 300) {
            settle({ ok: true, statusCode });
            return;
          }
          const text = Buffer.concat(chunks).toString('utf8').slice(0, MAX_ERROR_BODY_BYTES);
          settle({
            ok: false,
            statusCode,
            error: `Receiver responded ${String(statusCode)}${text === '' ? '' : `: ${text}`}`,
          });
        });
        response.on('error', (err: Error) => {
          settle({ ok: false, statusCode, error: err.message });
        });
      }
    );

    request.setTimeout(SEND_TIMEOUT_MS, () => {
      request.destroy(new Error(`Timed out after ${String(SEND_TIMEOUT_MS)}ms`));
    });
    request.on('error', (err: Error) => {
      settle({ ok: false, error: err.message });
    });
    request.end(body);
  });
}
