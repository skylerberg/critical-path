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

  // The boundaries are literal rather than RESET_TOKEN_TTL_MS arithmetic: the
  // producer uses the same constant, so deriving them holds for any value and
  // the 15 minutes README.md, CLAUDE.md and the mailed body all promise would be
  // free to become 15 hours.
  it('expires fifteen minutes after it was minted', () => {
    const now = 1_700_000_000_000;
    const token = createResetToken(ALT_ID, now);
    expect(RESET_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
    expect(verifyResetToken(token, now + 899_999)).toEqual({ alternative_id: ALT_ID });
    expect(verifyResetToken(token, now + 900_000)).toBeNull();
    expect(verifyResetTokenDetailed(token, now + 900_000)).toEqual({ status: 'expired' });
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

type Env = (typeof import('../../src/config/env'))['env'];

// The secret both mailed-link families sign with. Its production guard is a
// lazy getter rather than a boot assertion, so it is reached by stubbing the
// environment around the call rather than at boot.
describe('env.passwordResetSecret', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadEnv(environment: string, secret: string): Promise<Env> {
    vi.stubEnv('ENVIRONMENT', environment);
    vi.stubEnv('PASSWORD_RESET_SECRET', secret);
    vi.stubEnv('EMAIL_TOKEN_SECRET', '');
    vi.resetModules();
    return (await import('../../src/config/env')).env;
  }

  it('falls back to the secret published in this repo outside production', async () => {
    const env = await loadEnv('development', '');
    expect(env.passwordResetSecret).toBe(DEV_SECRET);
    expect(env.emailTokenSecret).toBe(DEV_SECRET);
  });

  it('refuses that fallback in production, for both token families', async () => {
    const env = await loadEnv('production', '');
    expect(() => env.passwordResetSecret).toThrow(
      'PASSWORD_RESET_SECRET is required in production'
    );
    expect(() => env.emailTokenSecret).toThrow('PASSWORD_RESET_SECRET is required in production');
  });

  it('returns the configured secret in production', async () => {
    const env = await loadEnv('production', 'a-real-production-secret');
    expect(env.passwordResetSecret).toBe('a-real-production-secret');
    expect(env.emailTokenSecret).toBe('a-real-production-secret');
  });
});
