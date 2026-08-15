import { describe, it, expect, afterEach, vi } from 'vitest';
import { env } from '../../src/config/env';

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
