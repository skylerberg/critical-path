import http from 'node:http';
import https from 'node:https';
import { APP_NAME } from '../../config/constants';
import {
  assertRegistrableWebhookUrl,
  blockedTargetLookup,
  type LookupAll,
  type TargetPolicy,
} from '../webhooks/targets';

export interface FetchLimits {
  maxBytes: number;
  deadlineMs: number;
  // Accepted Content-Type prefixes; a response outside them errors with the
  // body unread.
  accept: string[];
}

export interface FetchResult {
  finalUrl: string;
  contentType: string;
  body: Buffer;
}

const MAX_REDIRECTS = 3;
const USER_AGENT = `${APP_NAME.replace(/\s+/g, '')}-Unfurl/1`;

export class UnfurlFetchError extends Error {}

// node:http request() rather than fetch, for the same two reasons the webhook
// sender uses it: only request() takes the `lookup` option that pins the socket
// to the vetted address, and it does not follow redirects, so every hop is
// re-validated instead of only the first.
export async function fetchVetted(
  url: string,
  limits: FetchLimits,
  policy: TargetPolicy,
  resolve?: LookupAll
): Promise<FetchResult> {
  const deadline = Date.now() + limits.deadlineMs;
  let target = url;

  for (let hop = 0; ; hop++) {
    assertRegistrableWebhookUrl(target, policy);

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new UnfurlFetchError(`Timed out after ${String(limits.deadlineMs)}ms`);
    }

    const response = await requestOnce(target, limits, policy, remaining, resolve);

    if (response.kind === 'redirect') {
      if (hop >= MAX_REDIRECTS) {
        throw new UnfurlFetchError('Too many redirects');
      }
      target = response.location;
      continue;
    }

    return { finalUrl: target, contentType: response.contentType, body: response.body };
  }
}

type RequestOutcome =
  | { kind: 'redirect'; location: string }
  | { kind: 'body'; contentType: string; body: Buffer };

function acceptable(contentType: string, accept: string[]): boolean {
  const value = contentType.toLowerCase();
  return accept.some((prefix) => value.startsWith(prefix));
}

function requestOnce(
  target: string,
  limits: FetchLimits,
  policy: TargetPolicy,
  timeoutMs: number,
  resolve?: LookupAll
): Promise<RequestOutcome> {
  const parsed = new URL(target);
  const transport = parsed.protocol === 'https:' ? https : http;

  return new Promise<RequestOutcome>((settleWith, rejectWith) => {
    let settled = false;
    const settle = (outcome: RequestOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      settleWith(outcome);
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      rejectWith(new UnfurlFetchError(message));
    };

    const request = transport.request(
      parsed,
      {
        method: 'GET',
        // The global agent reuses sockets by host:port, which would skip the
        // lookup entirely after the first request to a host.
        agent: false,
        lookup: blockedTargetLookup(policy, resolve),
        headers: {
          Accept: `${limits.accept.join(',')},*/*;q=0.1`,
          // Nothing is ever decompressed, so a compression bomb is structurally
          // impossible rather than merely capped.
          'Accept-Encoding': 'identity',
          'User-Agent': USER_AGENT,
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;

        if (status >= 300 && status < 400) {
          const location = response.headers.location;
          response.destroy();
          if (location === undefined || location === '') {
            fail(`Redirect ${String(status)} without a Location`);
            return;
          }
          let resolved: string;
          try {
            resolved = new URL(location, target).toString();
          } catch {
            fail('Redirect Location is not a valid URL');
            return;
          }
          settle({ kind: 'redirect', location: resolved });
          return;
        }

        if (status < 200 || status >= 300) {
          response.destroy();
          fail(`Target responded ${String(status)}`);
          return;
        }

        const contentType = (response.headers['content-type'] ?? '').split(';')[0].trim();
        if (!acceptable(contentType, limits.accept)) {
          response.destroy();
          fail(`Unexpected content type ${contentType === '' ? '(none)' : contentType}`);
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > limits.maxBytes) {
            response.destroy();
            request.destroy();
            fail(`Response exceeded ${String(limits.maxBytes)} bytes`);
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          settle({ kind: 'body', contentType, body: Buffer.concat(chunks) });
        });
        response.on('error', (err: Error) => {
          fail(err.message);
        });
      }
    );

    // An absolute deadline, not request.setTimeout: that is a socket inactivity
    // timer, so a server trickling one byte a second never trips it.
    const deadline = setTimeout(() => {
      fail(`Timed out after ${String(timeoutMs)}ms`);
      request.destroy();
    }, timeoutMs);

    request.on('error', (err: Error) => {
      fail(err.message);
    });
    request.end();
  });
}
