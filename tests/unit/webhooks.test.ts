import crypto from 'crypto';
import type dns from 'node:dns';
import { describe, it, expect } from 'vitest';
import {
  BACKOFF_SECONDS,
  MAX_ATTEMPTS,
  WEBHOOK_EVENT_TYPES,
  assertRegistrableWebhookUrl,
  blockedTargetLookup,
  generateWebhookSecret,
  isWebhookEvent,
  signWebhookBody,
  type LookupAll,
  type TargetPolicy,
} from '../../src/services/webhooks/index';
import { AppError } from '../../src/utils/errors';

const strict: TargetPolicy = { allowPrivate: false, requireHttps: false };
const prod: TargetPolicy = { allowPrivate: false, requireHttps: true };
const dev: TargetPolicy = { allowPrivate: true, requireHttps: false };

function rejection(url: string, policy: TargetPolicy): AppError {
  try {
    assertRegistrableWebhookUrl(url, policy);
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error(`Expected ${url} to be rejected`);
}

const resolveTo =
  (...addresses: dns.LookupAddress[]): LookupAll =>
  () =>
    Promise.resolve(addresses);

function lookupResult(
  lookup: ReturnType<typeof blockedTargetLookup>,
  options: dns.LookupOptions
): Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }> {
  return new Promise((resolve) => {
    // The Node signature is overloaded on options.all; both arms land here.
    (
      lookup as unknown as (
        hostname: string,
        options: dns.LookupOptions,
        callback: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void
      ) => void
    )('receiver.example.com', options, (err, address, family) => {
      resolve({ err, address, family });
    });
  });
}

describe('assertRegistrableWebhookUrl', () => {
  it('rejects loopback, private, link-local and reserved targets', () => {
    for (const url of [
      'http://127.0.0.1/x',
      'http://127.9.9.9/x',
      'http://10.0.0.5/x',
      'http://172.16.0.1/x',
      'http://192.168.1.1/x',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/x',
      'http://0.0.0.0/x',
      // Decimal, hex, octal and short forms all normalize to 127.0.0.1.
      'http://2130706433/x',
      'http://0x7f000001/x',
      'http://017700000001/x',
      'http://127.1/x',
    ]) {
      expect(rejection(url, strict).statusCode).toBe(422);
    }
  });

  it('rejects bracketed IPv6 literals, including every IPv4-embedding form', () => {
    for (const url of [
      'http://[::1]/x',
      'http://[fd00::1]/x',
      'http://[fe80::1]/x',
      'http://[::ffff:10.0.0.1]/x',
      'http://[64:ff9b::a00:1]/x',
      // 6to4 (embedding 169.254.169.254), Teredo, and the 6to4 relay anycast.
      'http://[2002:a9fe:a9fe::]/x',
      'http://[2001:0:53aa:64c:0:0:a00:1]/x',
      'http://192.88.99.1/x',
    ]) {
      expect(rejection(url, strict).message).toMatch(/private, loopback, or reserved/);
    }
  });

  it('rejects internal-looking DNS names', () => {
    for (const url of [
      'http://localhost/x',
      'https://foo.localhost/x',
      'https://box.internal/x',
      'https://printer.local/x',
      'https://router/x',
      'https://metadata/x',
    ]) {
      expect(rejection(url, strict).message).toMatch(/private, loopback, or reserved/);
    }
  });

  it('rejects malformed URLs, other schemes, and embedded credentials', () => {
    expect(rejection('not a url', strict).message).toMatch(/valid absolute URL/);
    expect(rejection('ftp://example.com/x', strict).message).toMatch(/http or https/);
    expect(rejection('https://user:pass@example.com/x', strict).message).toMatch(/credentials/);
  });

  it('accepts ordinary public targets', () => {
    for (const url of [
      'https://example.com/hook',
      'https://example.com:8443/hook?a=1',
      'http://93.184.216.34/hook',
      'https://hooks.slack.example/services/abc',
      // Only reachable through the bracket strip: unstripped it is neither an
      // IP to net.isIP nor a dotted name, so it would be refused as intranet.
      'http://[2606:4700:4700::1111]/hook',
    ]) {
      expect(() => assertRegistrableWebhookUrl(url, strict)).not.toThrow();
    }
  });

  it('requires https only when the policy says so', () => {
    expect(() => assertRegistrableWebhookUrl('http://example.com/hook', strict)).not.toThrow();
    expect(rejection('http://example.com/hook', prod).message).toMatch(/must use https/);
    expect(() => assertRegistrableWebhookUrl('https://example.com/hook', prod)).not.toThrow();
  });

  it('lets private targets through when the policy allows them', () => {
    expect(() => assertRegistrableWebhookUrl('http://127.0.0.1:8080/hook', dev)).not.toThrow();
    expect(() => assertRegistrableWebhookUrl('http://localhost:3000/hook', dev)).not.toThrow();
    expect(rejection('ftp://localhost/x', dev).message).toMatch(/http or https/);
  });
});

describe('blockedTargetLookup', () => {
  it('refuses every resolved address that is blocked', async () => {
    for (const address of [
      { address: '169.254.169.254', family: 4 } as const,
      { address: '10.0.0.5', family: 4 } as const,
      { address: '127.0.0.1', family: 4 } as const,
      { address: '::1', family: 6 } as const,
      { address: 'fd00::1', family: 6 } as const,
      { address: '::ffff:a00:1', family: 6 } as const,
    ]) {
      const { err } = await lookupResult(blockedTargetLookup(strict, resolveTo(address)), {
        all: true,
      });
      expect(err?.code).toBe('EBLOCKED');
    }
  });

  it('passes a public address through', async () => {
    const { err, address } = await lookupResult(
      blockedTargetLookup(strict, resolveTo({ address: '93.184.216.34', family: 4 })),
      { all: true }
    );
    expect(err).toBeNull();
    expect(address).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('keeps only the public addresses out of a mixed answer', async () => {
    const { err, address } = await lookupResult(
      blockedTargetLookup(
        strict,
        resolveTo({ address: '127.0.0.1', family: 4 }, { address: '93.184.216.34', family: 4 })
      ),
      { all: true }
    );
    expect(err).toBeNull();
    expect(address).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('allows a blocked address when the policy allows private targets', async () => {
    const { err, address } = await lookupResult(
      blockedTargetLookup(dev, resolveTo({ address: '127.0.0.1', family: 4 })),
      { all: true }
    );
    expect(err).toBeNull();
    expect(address).toEqual([{ address: '127.0.0.1', family: 4 }]);
  });

  it('answers an array for all:true and a triple otherwise', async () => {
    const lookup = blockedTargetLookup(strict, resolveTo({ address: '93.184.216.34', family: 4 }));

    const all = await lookupResult(lookup, { all: true });
    expect(Array.isArray(all.address)).toBe(true);

    for (const options of [{}, { all: false }]) {
      const single = await lookupResult(lookup, options);
      expect(single.address).toBe('93.184.216.34');
      expect(single.family).toBe(4);
    }
  });

  it('propagates a resolver failure to the callback', async () => {
    const { err } = await lookupResult(
      blockedTargetLookup(strict, () => Promise.reject(new Error('ENOTFOUND'))),
      { all: true }
    );
    expect(err?.message).toBe('ENOTFOUND');
  });
});

describe('webhook signing', () => {
  it('reproduces the signature a receiver would compute', () => {
    const secret = 'shhh';
    const body = JSON.stringify({ id: 'd1', type: 'task_created' });
    const timestamp = 1_700_000_000;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${String(timestamp)}.${body}`)
      .digest('hex');

    expect(signWebhookBody(secret, timestamp, body)).toBe(expected);
  });

  it('changes with the timestamp, the body, and the secret', () => {
    const body = '{"a":1}';
    const base = signWebhookBody('s', 100, body);
    expect(signWebhookBody('s', 101, body)).not.toBe(base);
    expect(signWebhookBody('s', 100, '{"a":2}')).not.toBe(base);
    expect(signWebhookBody('t', 100, body)).not.toBe(base);
  });

  it('generates distinct high-entropy secrets', () => {
    const secrets = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const secret = generateWebhookSecret();
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      secrets.add(secret);
    }
    expect(secrets.size).toBe(100);
  });
});

describe('webhook event catalogue', () => {
  it('covers every project-scoped event type', () => {
    for (const type of [
      'task_created',
      'task_updated',
      'task_deleted',
      'task_archived',
      'task_restored',
      'task_relations_set',
      'column_created',
      'column_updated',
      'column_deleted',
      'label_created',
      'label_updated',
      'label_deleted',
      'image_created',
      'image_deleted',
      'comment_created',
      'comment_updated',
      'comment_deleted',
      'project_updated',
    ]) {
      expect(isWebhookEvent(type)).toBe(true);
    }
    expect(WEBHOOK_EVENT_TYPES.size).toBe(18);
  });

  it('excludes events that cannot or must not be delivered', () => {
    for (const type of [
      'project_created',
      'project_deleted',
      'project_position_updated',
      'user_updated',
      'sessions_revoked',
      'not_a_real_event',
    ]) {
      expect(isWebhookEvent(type)).toBe(false);
    }
  });
});

describe('retry schedule', () => {
  it('keeps MAX_ATTEMPTS in step with the backoff table', () => {
    expect(MAX_ATTEMPTS).toBe(BACKOFF_SECONDS.length + 1);
  });

  it('backs off strictly further each time', () => {
    for (let i = 1; i < BACKOFF_SECONDS.length; i++) {
      expect(BACKOFF_SECONDS[i]).toBeGreaterThan(BACKOFF_SECONDS[i - 1]);
    }
  });
});
