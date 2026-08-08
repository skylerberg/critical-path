import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import { blockedTargetLookup, type LookupAll, type TargetPolicy } from './webhooks/targets';

// Not exported: every caller wraps or maps the rejection into its own outcome
// type, and only the name in a stack trace is load-bearing.
class VettedRequestError extends Error {}

export interface VettedRequestOptions {
  target: URL;
  method: 'GET' | 'POST';
  headers: OutgoingHttpHeaders;
  body?: string;
  timeoutMs: number;
  policy: TargetPolicy;
  resolve?: LookupAll;
}

export interface VettedExchange<T> {
  response: IncomingMessage;
  settle: (value: T) => void;
  fail: (message: string) => void;
  abortRequest: () => void;
}

// The transport mechanics every outbound request to a user-supplied address
// shares, and nothing else: policy — which statuses are acceptable, whether
// redirects are followed, how much of the body is read and what a cap means —
// belongs to `onResponse`.
//
// node:http request() rather than fetch: only it takes the `lookup` option that
// pins the connection to the vetted address, and it never follows redirects, so
// a caller that wants them re-validates each hop itself instead of the first
// one deciding where the socket ends up.
//
// Rejects with a VettedRequestError when the deadline expires or the socket
// fails, and whenever `onResponse` calls `fail`; resolves only through `settle`.
// Whichever comes first wins and the rest are dropped.
export function vettedRequest<T>(
  options: VettedRequestOptions,
  onResponse: (exchange: VettedExchange<T>) => void
): Promise<T> {
  const transport = options.target.protocol === 'https:' ? https : http;

  return new Promise<T>((resolveWith, rejectWith) => {
    let settled = false;
    const settle = (value: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolveWith(value);
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      rejectWith(new VettedRequestError(message));
    };

    const request = transport.request(
      options.target,
      {
        method: options.method,
        // The global agent keeps sockets alive and reuses them by host:port,
        // which skips the lookup entirely on every request after the first.
        agent: false,
        lookup: blockedTargetLookup(options.policy, options.resolve),
        headers: options.headers,
      },
      (response) => {
        onResponse({
          response,
          settle,
          fail,
          abortRequest: () => {
            request.destroy();
          },
        });
      }
    );

    // An absolute deadline, not request.setTimeout: that is a socket inactivity
    // timer, so a peer trickling one byte a second never trips it and never
    // settles.
    const deadline = setTimeout(() => {
      fail(`Timed out after ${String(options.timeoutMs)}ms`);
      request.destroy();
    }, options.timeoutMs);

    request.on('error', (err: Error) => {
      fail(err.message);
    });
    request.end(options.body);
  });
}
