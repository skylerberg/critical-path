import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { env } from '../config/env';

// One derivation of "who is calling", shared by the request path and the socket
// upgrade. Two would be two answers to the question every budget is keyed on,
// and the one that reads the header wrong is the one an attacker picks.
export function clientIpFrom(
  forwarded: string | string[] | undefined,
  socketAddress: string | undefined
): string {
  if (env.trustProxy) {
    // Entries left of the proxy-appended suffix are client-forgeable. GCP
    // HTTPS load balancers append "<client-ip>, <lb-ip>", hence hops=2 there.
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
