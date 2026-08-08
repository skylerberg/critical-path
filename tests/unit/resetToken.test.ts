import { describe, it, expect, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import {
  createResetToken,
  verifyResetToken,
  verifyResetTokenDetailed,
  RESET_TOKEN_TTL_MS,
} from '../../src/services/resetToken';

const ALT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const DEV_SECRET = 'dev-only-password-reset-secret';

function forge(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', DEV_SECRET).update(payload).digest('base64url')}`;
}

afterEach(() => {
  delete process.env.PASSWORD_RESET_SECRET;
  vi.restoreAllMocks();
});

describe('createResetToken / verifyResetToken', () => {
  it('round-trips a valid token', () => {
    const token = createResetToken(ALT_ID);
    expect(verifyResetToken(token)).toEqual({ alternative_id: ALT_ID });
    expect(verifyResetTokenDetailed(token)).toEqual({ status: 'valid', alternative_id: ALT_ID });
  });

  it('expires after the TTL', () => {
    const now = 1_700_000_000_000;
    const token = createResetToken(ALT_ID, now);
    expect(verifyResetToken(token, now + RESET_TOKEN_TTL_MS - 1)).toEqual({
      alternative_id: ALT_ID,
    });
    expect(verifyResetToken(token, now + RESET_TOKEN_TTL_MS)).toBeNull();
    expect(verifyResetTokenDetailed(token, now + RESET_TOKEN_TTL_MS)).toEqual({
      status: 'expired',
    });
  });

  it('rejects a tampered payload', () => {
    const token = createResetToken(ALT_ID);
    const [payload, signature] = token.split('.');
    const otherPayload = Buffer.from(
      JSON.stringify({ alternative_id: ALT_ID, exp: Date.now() + 10 * RESET_TOKEN_TTL_MS })
    ).toString('base64url');
    expect(verifyResetToken(`${otherPayload}.${signature}`)).toBeNull();
    expect(verifyResetTokenDetailed(`${otherPayload}.${signature}`)).toEqual({
      status: 'invalid',
    });
    expect(verifyResetToken(`${payload}x.${signature}`)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = createResetToken(ALT_ID);
    const [payload, signature] = token.split('.');
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    expect(verifyResetToken(`${payload}.${flipped}`)).toBeNull();
  });

  it('rejects malformed tokens without throwing', () => {
    for (const bad of ['', 'no-dot', 'a.b.c', '.', 'x.', '.y', 'payload.short-sig']) {
      expect(verifyResetToken(bad)).toBeNull();
    }
  });

  it('rejects a structurally valid payload missing required fields', () => {
    expect(verifyResetToken(forge({ t: 'reset', exp: Date.now() + 60_000 }))).toBeNull();
    expect(verifyResetToken(forge({ t: 'reset', alternative_id: ALT_ID }))).toBeNull();
  });

  it('rejects tokens signed with a different secret', () => {
    process.env.PASSWORD_RESET_SECRET = 'secret-one';
    const token = createResetToken(ALT_ID);
    process.env.PASSWORD_RESET_SECRET = 'secret-two';
    expect(verifyResetToken(token)).toBeNull();
    process.env.PASSWORD_RESET_SECRET = 'secret-one';
    expect(verifyResetToken(token)).toEqual({ alternative_id: ALT_ID });
  });

  it('names its own token family', () => {
    const claims = JSON.parse(
      Buffer.from(createResetToken(ALT_ID).split('.')[0], 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    expect(claims.t).toBe('reset');
  });

  it('rejects a correctly signed token that names no family or another one', () => {
    const exp = Date.now() + RESET_TOKEN_TTL_MS;
    expect(verifyResetToken(forge({ alternative_id: ALT_ID, exp }))).toBeNull();
    expect(verifyResetToken(forge({ t: 'verify', alternative_id: ALT_ID, exp }))).toBeNull();
  });

  it('compares signatures with timingSafeEqual', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    const token = createResetToken(ALT_ID);
    expect(verifyResetToken(token)).toEqual({ alternative_id: ALT_ID });
    expect(spy).toHaveBeenCalled();
  });
});
