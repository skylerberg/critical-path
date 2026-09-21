import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertSessionConfig, env } from '../../src/config/env';

afterEach(() => {
  vi.unstubAllEnvs();
});

// Read per call, not captured at import: `targetPolicy` is the only thing
// standing between a pasted link and the metadata service, and a test that sets
// ENVIRONMENT to reach it used to keep the policy it was already on.
describe('env.environment', () => {
  it('follows ENVIRONMENT, and calls anything but production or test development', () => {
    for (const [raw, expected] of [
      ['production', 'production'],
      ['test', 'test'],
      ['development', 'development'],
      ['staging', 'development'],
      ['Production', 'development'],
      ['', 'development'],
      [undefined, 'development'],
    ] as const) {
      vi.stubEnv('ENVIRONMENT', raw);
      expect(env.environment).toBe(expected);
    }
  });
});

// The reverse direction is covered in tests/unit/resetToken.test.ts: the reset
// secret is what the mail secret falls back to, and it may not fall back to the
// repository's dev secret in production.
describe('env.emailTokenSecret', () => {
  it('signs mailed links in production without lending its secret to a reset', () => {
    vi.stubEnv('ENVIRONMENT', 'production');
    vi.stubEnv('PASSWORD_RESET_SECRET', undefined);
    vi.stubEnv('EMAIL_TOKEN_SECRET', 'a-mail-secret');

    expect(env.emailTokenSecret).toBe('a-mail-secret');
    expect(() => env.passwordResetSecret).toThrow(
      'PASSWORD_RESET_SECRET is required in production'
    );
  });
});

// Strict where most of these are lenient, because the session cookie carries the
// same number and browsers clamp one over 400 days without a word. A longer TTL
// would leave the cookie and the row it mirrors on different clocks, and the
// only symptom is an <img> that 401s until some later read rebuilds the cookie —
// which nobody would trace back to here.
describe('env.sessionTtlDays', () => {
  it('defaults to a year, and takes any lifetime a cookie can carry', () => {
    vi.stubEnv('SESSION_TTL_DAYS', undefined);
    expect(env.sessionTtlDays).toBe(365);

    vi.stubEnv('SESSION_TTL_DAYS', '400');
    expect(env.sessionTtlDays).toBe(400);
  });

  it('refuses a lifetime no cookie can carry, and anything that is not whole days', () => {
    for (const raw of ['401', '4000', '0', '-1', '30.5', 'forever']) {
      vi.stubEnv('SESSION_TTL_DAYS', raw);
      expect(() => env.sessionTtlDays).toThrow('SESSION_TTL_DAYS must be a whole number of days');
    }
  });

  it('is read at boot, so a bad value fails the deploy and not the first login', () => {
    vi.stubEnv('SESSION_TTL_DAYS', '4000');
    expect(() => {
      assertSessionConfig();
    }).toThrow('SESSION_TTL_DAYS');
  });
});
