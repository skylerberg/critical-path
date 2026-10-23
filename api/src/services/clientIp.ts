import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { env } from '../config/env';

// Derives "who is calling" for both the request path and the socket upgrade.
// Two derivations would answer the question every budget is keyed on
// differently, and an attacker would pick the one that reads the header wrong.
export function clientIpFrom(
  forwarded: string | string[] | undefined,
  socketAddress: string | undefined
): string {
  if (env.trustProxy) {
    // Entries left of the proxy-appended suffix are client-forgeable. A GCP
    // HTTPS load balancer appends "<client-ip>, <lb-ip>", which is why the
    // deployment sets TRUST_PROXY_HOPS to 2.
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
