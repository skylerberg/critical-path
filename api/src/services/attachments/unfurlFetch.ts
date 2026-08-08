import { APP_NAME } from '../../config/constants';
import { errorText } from '../../utils/errors';
import { vettedRequest } from '../vettedHttp';
import {
  assertRegistrableWebhookUrl,
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

// Redirects are followed here rather than by the transport so every hop is
// re-validated against the policy, instead of only the first one deciding where
// the socket ends up. The deadline spans the whole chain, not each hop.
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
  return vettedRequest<RequestOutcome>(
    {
      target: new URL(target),
      method: 'GET',
      timeoutMs,
      policy,
      resolve,
      headers: {
        Accept: `${limits.accept.join(',')},*/*;q=0.1`,
        // Nothing is ever decompressed, so a compression bomb is structurally
        // impossible rather than merely capped.
        'Accept-Encoding': 'identity',
        'User-Agent': USER_AGENT,
      },
    },
    ({ response, settle, fail, abortRequest }) => {
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
          abortRequest();
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
  ).catch((err: unknown) => {
    // One error type for everything this module rejects with, whether the
    // refusal came from the policy, the socket or the deadline.
    throw new UnfurlFetchError(errorText(err));
  });
}
