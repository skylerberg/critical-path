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
    function settle(result: SendResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve_(result);
    }

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
        const finish = (): void => {
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
        };
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          received += chunk.length;
          // Stop at the cap rather than draining: an endless body would
          // otherwise hold the socket for as long as the receiver likes.
          if (received >= MAX_ERROR_BODY_BYTES) {
            finish();
            response.destroy();
          }
        });
        response.on('end', finish);
        response.on('error', (err: Error) => {
          settle({ ok: false, statusCode, error: err.message });
        });
      }
    );

    // An absolute deadline, not request.setTimeout: that is a socket inactivity
    // timer, so a receiver trickling bytes never trips it and never settles.
    const deadline = setTimeout(() => {
      settle({ ok: false, error: `Timed out after ${String(SEND_TIMEOUT_MS)}ms` });
      request.destroy();
    }, SEND_TIMEOUT_MS);
    request.on('error', (err: Error) => {
      settle({ ok: false, error: err.message });
    });
    request.end(body);
  });
}
