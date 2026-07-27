import dns from 'node:dns';
import net from 'node:net';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';

export interface TargetPolicy {
  allowPrivate: boolean;
  requireHttps: boolean;
}

export function targetPolicy(): TargetPolicy {
  const production = env.environment === 'production';
  return { allowPrivate: !production, requireHttps: production };
}

const blockList = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['192.88.99.0', 24],
] as const) {
  blockList.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  // NAT64, 6to4 and Teredo all embed an IPv4 address; without them a
  // synthesised prefix tunnels straight to a private v4 target.
  ['64:ff9b::', 96],
  ['2002::', 16],
  ['2001::', 32],
] as const) {
  blockList.addSubnet(network, prefix, 'ipv6');
}

const BLOCKED_MESSAGE = 'Webhook URL must not point at a private, loopback, or reserved address';

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal'];

export function isBlockedAddress({ address, family }: dns.LookupAddress): boolean {
  return blockList.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

// Synchronous and network-free, so it is safe inside a request transaction.
export function assertRegistrableWebhookUrl(rawUrl: string, policy: TargetPolicy): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(422, 'Webhook URL must be a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(422, 'Webhook URL must use http or https');
  }
  if (policy.requireHttps && url.protocol !== 'https:') {
    throw new AppError(422, 'Webhook URL must use https');
  }
  if (url.username !== '' || url.password !== '') {
    throw new AppError(422, 'Webhook URL must not include credentials');
  }
  if (policy.allowPrivate) {
    return;
  }

  // URL keeps IPv6 literals bracketed and net.isIP rejects the bracketed form,
  // so without stripping every IPv6 literal would fall through to the name branch.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const family = net.isIP(host);
  if (family !== 0) {
    if (isBlockedAddress({ address: host, family })) {
      throw new AppError(422, BLOCKED_MESSAGE);
    }
    return;
  }

  if (
    host === 'localhost' ||
    BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    !host.includes('.')
  ) {
    throw new AppError(422, BLOCKED_MESSAGE);
  }
}

export type LookupAll = (
  hostname: string,
  options: dns.LookupOptions
) => Promise<dns.LookupAddress[]>;

const defaultResolve: LookupAll = (hostname, options) =>
  dns.promises.lookup(hostname, { ...options, all: true });

// Passed as the `lookup` option so the vetted address is the one the socket
// connects to; re-checking after resolution is what closes DNS rebinding.
export function blockedTargetLookup(
  policy: TargetPolicy,
  resolve: LookupAll = defaultResolve
): net.LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, options).then(
      (addresses) => {
        const allowed = policy.allowPrivate
          ? addresses
          : addresses.filter((address) => !isBlockedAddress(address));
        if (allowed.length === 0) {
          const err: NodeJS.ErrnoException = new Error(
            `Refusing to connect to a blocked address for ${hostname}`
          );
          err.code = 'EBLOCKED';
          callback(err, '');
          return;
        }
        // autoSelectFamily makes net.connect pass { all: true } and expect an
        // array back; a single-address callback fails the request outright.
        if (options.all === true) {
          callback(null, allowed);
        } else {
          callback(null, allowed[0].address, allowed[0].family);
        }
      },
      (err: unknown) => callback(err as NodeJS.ErrnoException, '')
    );
  };
}
