import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { env } from '../config/env';

// The single derivation of "who is calling", shared by the request path and the
// socket upgrade: rate-limit budgets are keyed on this value, so a second
// implementation reading the header differently would let an attacker pick
// whichever is cheaper to satisfy.
export function clientIpFrom(
  forwarded: string | string[] | undefined,
  socketAddress: string | undefined
): string {
  if (env.trustProxy) {
    // A client can put anything in x-forwarded-for; only the entries a trusted
    // proxy appended are reliable, and those count from the right. GCP HTTPS
    // load balancers append "<client-ip>, <lb-ip>", so TRUST_PROXY_HOPS=2 there.
    const header = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    if (header) {
      const entries = header.split(',');
      const candidate = entries[entries.length - env.trustProxyHops]?.trim();
      if (candidate) {
        return candidate;
      }
    }
  }
  return socketAddress ?? 'unknown';
}

function socketAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

export function clientIp(c: Context): string {
  return clientIpFrom(c.req.header('x-forwarded-for'), socketAddress(c));
}
