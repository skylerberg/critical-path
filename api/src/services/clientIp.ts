import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { env } from '../config/env';

// One derivation of "who is calling", shared by the request path and the socket
// upgrade. Every budget is keyed on it, so a second derivation would give an
// attacker a choice of which one to fool.
export function clientIpFrom(
  forwarded: string | string[] | undefined,
  socketAddress: string | undefined
): string {
  if (env.trustProxy) {
    // Entries left of the suffix a trusted proxy appends are client-forgeable:
    // a GCP HTTPS load balancer appends "<client-ip>, <lb-ip>", so hops are
    // counted from the right.
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
