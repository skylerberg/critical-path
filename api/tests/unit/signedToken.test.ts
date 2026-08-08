import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import { decodeSignedToken, encodeSignedToken } from '../../src/services/signedToken';

const SECRET = 'unit-test-secret';

function forge(secret: string, claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('encodeSignedToken / decodeSignedToken', () => {
  it('round-trips claims under the type it was minted with', () => {
    const token = encodeSignedToken(SECRET, 'alpha', { uid: 'u1', n: 7 });
    expect(decodeSignedToken(SECRET, 'alpha', token)).toEqual({ t: 'alpha', uid: 'u1', n: 7 });
  });

  it('writes the type as the first claim', () => {
    const token = encodeSignedToken(SECRET, 'alpha', { uid: 'u1' });
    const payload = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
    expect(payload).toBe('{"t":"alpha","uid":"u1"}');
  });

  it('refuses to decode a token minted under another type', () => {
    const token = encodeSignedToken(SECRET, 'alpha', { uid: 'u1' });
    expect(decodeSignedToken(SECRET, 'beta', token)).toBeNull();
  });

  it('rejects a correctly signed token that names no type', () => {
    expect(decodeSignedToken(SECRET, 'alpha', forge(SECRET, { uid: 'u1' }))).toBeNull();
  });

  it('rejects a tampered payload and a tampered signature', () => {
    const token = encodeSignedToken(SECRET, 'alpha', { uid: 'u1' });
    const [payload, signature] = token.split('.');
    const otherPayload = Buffer.from(JSON.stringify({ t: 'alpha', uid: 'u2' })).toString(
      'base64url'
    );
    expect(decodeSignedToken(SECRET, 'alpha', `${otherPayload}.${signature}`)).toBeNull();

    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    expect(decodeSignedToken(SECRET, 'alpha', `${payload}.${flipped}`)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = encodeSignedToken('secret-one', 'alpha', { uid: 'u1' });
    expect(decodeSignedToken('secret-two', 'alpha', token)).toBeNull();
  });

  it('rejects malformed tokens without throwing', () => {
    for (const bad of ['', 'no-dot', 'a.b.c', '.', 'x.', '.y', 'payload.short-sig']) {
      expect(decodeSignedToken(SECRET, 'alpha', bad)).toBeNull();
    }
  });

  it('rejects a signed payload that is not a JSON object', () => {
    for (const claims of ['[]', '"alpha"', '3', 'null']) {
      const payload = Buffer.from(claims).toString('base64url');
      const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
      expect(decodeSignedToken(SECRET, 'alpha', `${payload}.${signature}`)).toBeNull();
    }
  });

  it('compares signatures with timingSafeEqual', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    const token = encodeSignedToken(SECRET, 'alpha', { uid: 'u1' });
    expect(decodeSignedToken(SECRET, 'alpha', token)).not.toBeNull();
    expect(spy).toHaveBeenCalled();
  });

  it('reserves the type claim from callers, which type-check enforces', () => {
    // @ts-expect-error passing the reserved claim would override the type argument
    expect(() => encodeSignedToken(SECRET, 'alpha', { t: 'beta' })).not.toThrow();
  });
});
