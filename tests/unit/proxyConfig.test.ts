import { describe, it, expect, afterEach } from 'vitest';
import { assertProxyConfig, env } from '../../src/config/env';

afterEach(() => {
  delete process.env.TRUST_PROXY;
  delete process.env.TRUST_PROXY_HOPS;
});

describe('TRUST_PROXY', () => {
  it('defaults to off when unset or empty', () => {
    expect(env.trustProxy).toBe(false);
    process.env.TRUST_PROXY = '';
    expect(env.trustProxy).toBe(false);
  });

  it('accepts true and false in any casing or padding', () => {
    for (const raw of ['true', 'TRUE', ' True ']) {
      process.env.TRUST_PROXY = raw;
      expect(env.trustProxy).toBe(true);
    }
    for (const raw of ['false', 'FALSE', ' False ']) {
      process.env.TRUST_PROXY = raw;
      expect(env.trustProxy).toBe(false);
    }
  });

  // The bug this replaces: every one of these used to read as false, quietly
  // putting every caller behind the load balancer into one rate-limit bucket.
  it('refuses a value that is not true or false', () => {
    for (const raw of ['1', '0', 'yes', 'no', 'on', 'off', 'ture']) {
      process.env.TRUST_PROXY = raw;
      expect(() => env.trustProxy).toThrow(/TRUST_PROXY must be "true" or "false"/);
    }
  });
});

describe('TRUST_PROXY_HOPS', () => {
  it('defaults to one when unset or empty', () => {
    expect(env.trustProxyHops).toBe(1);
    process.env.TRUST_PROXY_HOPS = '';
    expect(env.trustProxyHops).toBe(1);
  });

  it('accepts a whole number of one or more', () => {
    process.env.TRUST_PROXY_HOPS = '2';
    expect(env.trustProxyHops).toBe(2);
    process.env.TRUST_PROXY_HOPS = ' 10 ';
    expect(env.trustProxyHops).toBe(10);
  });

  // '2x' used to parse as 2 and 'abc' as the default, either of which points the
  // reader at a different X-Forwarded-For entry than the deployment intended.
  it('refuses anything that is not a whole number of one or more', () => {
    for (const raw of ['abc', '2x', '1.5', '-1', '0', '+2', '1e3']) {
      process.env.TRUST_PROXY_HOPS = raw;
      expect(() => env.trustProxyHops).toThrow(/TRUST_PROXY_HOPS must be a whole number/);
    }
  });
});

describe('assertProxyConfig', () => {
  it('passes for a valid pair', () => {
    process.env.TRUST_PROXY = 'true';
    process.env.TRUST_PROXY_HOPS = '2';
    expect(() => {
      assertProxyConfig();
    }).not.toThrow();
  });

  it('fails the boot for either variable, so neither waits for a request', () => {
    process.env.TRUST_PROXY = '1';
    expect(() => {
      assertProxyConfig();
    }).toThrow(/TRUST_PROXY/);

    process.env.TRUST_PROXY = 'true';
    process.env.TRUST_PROXY_HOPS = 'two';
    expect(() => {
      assertProxyConfig();
    }).toThrow(/TRUST_PROXY_HOPS/);
  });

  // Checked even when the header is not trusted: a typo left in place is still a
  // mistake, and it would otherwise surface only on the day trust is turned on.
  it('checks the hop count even when the proxy is not trusted', () => {
    process.env.TRUST_PROXY = 'false';
    process.env.TRUST_PROXY_HOPS = 'nope';
    expect(() => {
      assertProxyConfig();
    }).toThrow(/TRUST_PROXY_HOPS/);
  });
});
