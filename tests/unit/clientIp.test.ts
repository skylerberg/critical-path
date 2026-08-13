import { describe, it, expect, afterEach } from 'vitest';
import { clientIpFrom } from '../../src/services/clientIp';

// The one derivation of "who is calling", shared by the request path and the
// socket upgrade. Both the login budget and the per-address socket ceiling are
// keyed on what it returns, so a wrong answer here is either a ceiling one
// caller can escape by choosing a header or one that collapses every caller
// behind the load balancer into a single bucket.
describe('clientIpFrom', () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY_HOPS;
  });

  it('ignores the forwarded header entirely when TRUST_PROXY is off', () => {
    expect(clientIpFrom('1.2.3.4, 5.6.7.8', '10.0.0.1')).toBe('10.0.0.1');
  });

  it('answers unknown rather than throwing when there is no address at all', () => {
    expect(clientIpFrom(undefined, undefined)).toBe('unknown');
  });

  describe('with TRUST_PROXY on', () => {
    it('takes the rightmost entry at the default hop count', () => {
      process.env.TRUST_PROXY = 'true';
      expect(clientIpFrom('spoofed, 1.2.3.4', '10.0.0.1')).toBe('1.2.3.4');
    });

    // The production shape: a GCP HTTPS load balancer appends
    // "<client-ip>, <lb-ip>", so the client sits two from the right and
    // everything left of it is caller-supplied.
    it('takes the entry TRUST_PROXY_HOPS from the right', () => {
      process.env.TRUST_PROXY = 'true';
      process.env.TRUST_PROXY_HOPS = '2';
      expect(clientIpFrom('spoofed, 203.0.113.9, 130.211.0.1', '10.0.0.1')).toBe('203.0.113.9');
    });

    it('cannot be displaced by extra entries the caller prepends', () => {
      process.env.TRUST_PROXY = 'true';
      process.env.TRUST_PROXY_HOPS = '2';
      const forged = '9.9.9.9, 8.8.8.8, 7.7.7.7, 203.0.113.9, 130.211.0.1';
      expect(clientIpFrom(forged, '10.0.0.1')).toBe('203.0.113.9');
    });

    // Node hands duplicate headers to a raw upgrade listener as an array, which
    // the request path never sees; joining is what keeps one derivation honest
    // for both.
    it('reads a duplicated header the same as the joined form', () => {
      process.env.TRUST_PROXY = 'true';
      process.env.TRUST_PROXY_HOPS = '2';
      expect(clientIpFrom(['spoofed', '203.0.113.9, 130.211.0.1'], '10.0.0.1')).toBe('203.0.113.9');
    });

    it('falls back to the socket address when the header names too few hops', () => {
      process.env.TRUST_PROXY = 'true';
      process.env.TRUST_PROXY_HOPS = '5';
      expect(clientIpFrom('1.2.3.4, 5.6.7.8', '10.0.0.1')).toBe('10.0.0.1');
    });

    it('falls back to the socket address for an empty or blank entry', () => {
      process.env.TRUST_PROXY = 'true';
      expect(clientIpFrom('', '10.0.0.1')).toBe('10.0.0.1');
      expect(clientIpFrom('1.2.3.4, ', '10.0.0.1')).toBe('10.0.0.1');
    });

    it('trims surrounding whitespace so one client is one key', () => {
      process.env.TRUST_PROXY = 'true';
      expect(clientIpFrom('  203.0.113.9  ', '10.0.0.1')).toBe('203.0.113.9');
    });
  });
});
