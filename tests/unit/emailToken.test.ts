import { describe, it, expect, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import {
  createUnsubscribeToken,
  createVerificationToken,
  emailAddressHash,
  verifyUnsubscribeToken,
  verifyVerificationToken,
  VERIFICATION_TOKEN_TTL_MS,
} from '../../src/services/emailToken';
import { createResetToken, verifyResetTokenDetailed } from '../../src/services/resetToken';

const USER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const EMAIL = 'Verify.Me@example.com';
const DEV_SECRET = 'dev-only-password-reset-secret';

function signWith(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function forge(claims: Record<string, unknown>, secret = DEV_SECRET): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${signWith(secret, payload)}`;
}

afterEach(() => {
  delete process.env.PASSWORD_RESET_SECRET;
  delete process.env.EMAIL_TOKEN_SECRET;
  vi.restoreAllMocks();
});

describe('emailAddressHash', () => {
  it('ignores letter case', () => {
    expect(emailAddressHash('A@B.com')).toBe(emailAddressHash('a@b.com'));
  });

  it('differs between addresses and never contains the address', () => {
    const hash = emailAddressHash(EMAIL);
    expect(hash).not.toBe(emailAddressHash('other@example.com'));
    expect(hash.toLowerCase()).not.toContain('verify');
    expect(hash).not.toContain('@');
  });
});

describe('createVerificationToken / verifyVerificationToken', () => {
  it('round-trips a valid token', () => {
    const token = createVerificationToken(USER_ID, EMAIL);
    expect(verifyVerificationToken(token)).toEqual({
      status: 'valid',
      user_id: USER_ID,
      email_hash: emailAddressHash(EMAIL),
    });
  });

  it('expires at the TTL boundary, not after it', () => {
    const now = 1_700_000_000_000;
    const token = createVerificationToken(USER_ID, EMAIL, now);
    expect(verifyVerificationToken(token, now + VERIFICATION_TOKEN_TTL_MS - 1).status).toBe(
      'valid'
    );
    expect(verifyVerificationToken(token, now + VERIFICATION_TOKEN_TTL_MS)).toEqual({
      status: 'expired',
    });
  });

  it('rejects a flipped signature byte', () => {
    const token = createVerificationToken(USER_ID, EMAIL);
    const [payload, signature] = token.split('.');
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    expect(verifyVerificationToken(`${payload}.${flipped}`)).toEqual({ status: 'invalid' });
  });

  it('rejects a payload swapped under a valid signature', () => {
    const token = createVerificationToken(USER_ID, EMAIL);
    const signature = token.split('.')[1];
    const otherPayload = Buffer.from(
      JSON.stringify({ t: 'verify', uid: USER_ID, eh: emailAddressHash(EMAIL), exp: 4e12 })
    ).toString('base64url');
    expect(verifyVerificationToken(`${otherPayload}.${signature}`)).toEqual({ status: 'invalid' });
  });

  it('rejects tokens signed with a different secret', () => {
    process.env.EMAIL_TOKEN_SECRET = 'secret-one';
    const token = createVerificationToken(USER_ID, EMAIL);
    process.env.EMAIL_TOKEN_SECRET = 'secret-two';
    expect(verifyVerificationToken(token)).toEqual({ status: 'invalid' });
    process.env.EMAIL_TOKEN_SECRET = 'secret-one';
    expect(verifyVerificationToken(token).status).toBe('valid');
  });

  it('falls back to the password-reset secret when no email secret is set', () => {
    process.env.PASSWORD_RESET_SECRET = 'shared-secret';
    const token = createVerificationToken(USER_ID, EMAIL);
    expect(verifyVerificationToken(token).status).toBe('valid');

    process.env.EMAIL_TOKEN_SECRET = 'distinct-secret';
    expect(verifyVerificationToken(token)).toEqual({ status: 'invalid' });
  });

  it('rejects malformed tokens without throwing', () => {
    for (const bad of ['', 'no-dot', 'a.b.c', '.', 'x.', '.y', 'payload.short-sig']) {
      expect(verifyVerificationToken(bad)).toEqual({ status: 'invalid' });
    }
  });

  it('rejects a correctly signed payload carrying another token type', () => {
    const claims = { uid: USER_ID, eh: emailAddressHash(EMAIL), exp: Date.now() + 60_000 };
    expect(verifyVerificationToken(forge({ ...claims, t: 'unsubscribe' }))).toEqual({
      status: 'invalid',
    });
    expect(verifyVerificationToken(forge(claims))).toEqual({ status: 'invalid' });
  });

  it('rejects a correctly signed payload missing a required claim', () => {
    const exp = Date.now() + 60_000;
    expect(verifyVerificationToken(forge({ t: 'verify', eh: 'x', exp })).status).toBe('invalid');
    expect(verifyVerificationToken(forge({ t: 'verify', uid: USER_ID, exp })).status).toBe(
      'invalid'
    );
    expect(verifyVerificationToken(forge({ t: 'verify', uid: USER_ID, eh: 'x' })).status).toBe(
      'invalid'
    );
  });

  it('is not interchangeable with a password-reset token in either direction', () => {
    expect(verifyVerificationToken(createResetToken(USER_ID))).toEqual({ status: 'invalid' });
    expect(verifyResetTokenDetailed(createVerificationToken(USER_ID, EMAIL))).toEqual({
      status: 'invalid',
    });
  });

  it('compares signatures with timingSafeEqual', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    expect(verifyVerificationToken(createVerificationToken(USER_ID, EMAIL)).status).toBe('valid');
    expect(spy).toHaveBeenCalled();
  });
});

describe('createUnsubscribeToken / verifyUnsubscribeToken', () => {
  it('round-trips each kind', () => {
    for (const kind of ['task_assigned', 'added_to_project'] as const) {
      expect(verifyUnsubscribeToken(createUnsubscribeToken(USER_ID, EMAIL, kind))).toEqual({
        status: 'valid',
        user_id: USER_ID,
        email_hash: emailAddressHash(EMAIL),
        kind,
      });
    }
  });

  it('commits to the address it was mailed to, ignoring letter case', () => {
    const token = createUnsubscribeToken(USER_ID, EMAIL.toUpperCase(), 'task_assigned');
    const verification = verifyUnsubscribeToken(token);

    expect(verification.status).toBe('valid');
    expect(verification.status === 'valid' && verification.email_hash).toBe(
      emailAddressHash(EMAIL)
    );
    expect(verification.status === 'valid' && verification.email_hash).not.toBe(
      emailAddressHash('moved-on@example.com')
    );
  });

  it('never expires', () => {
    const claims = JSON.parse(
      Buffer.from(
        createUnsubscribeToken(USER_ID, EMAIL, 'task_assigned').split('.')[0],
        'base64url'
      ).toString('utf8')
    ) as Record<string, unknown>;
    expect(claims).not.toHaveProperty('exp');
  });

  it('carries no email address', () => {
    const token = createUnsubscribeToken(USER_ID, EMAIL, 'task_assigned');
    expect(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')).not.toContain('@');
  });

  it('rejects a flipped signature byte and a foreign secret', () => {
    const token = createUnsubscribeToken(USER_ID, EMAIL, 'task_assigned');
    const [payload, signature] = token.split('.');
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    expect(verifyUnsubscribeToken(`${payload}.${flipped}`)).toEqual({ status: 'invalid' });

    process.env.EMAIL_TOKEN_SECRET = 'a-different-secret';
    expect(verifyUnsubscribeToken(token)).toEqual({ status: 'invalid' });
  });

  it('rejects a signed token naming a kind that does not exist, or naming no address', () => {
    const eh = emailAddressHash(EMAIL);
    expect(
      verifyUnsubscribeToken(forge({ t: 'unsubscribe', uid: USER_ID, eh, k: 'everything' }))
    ).toEqual({ status: 'invalid' });
    expect(verifyUnsubscribeToken(forge({ t: 'unsubscribe', uid: USER_ID, eh }))).toEqual({
      status: 'invalid',
    });
    expect(
      verifyUnsubscribeToken(forge({ t: 'unsubscribe', uid: USER_ID, k: 'task_assigned' }))
    ).toEqual({ status: 'invalid' });
  });

  it('is not interchangeable with the other two token families in either direction', () => {
    const unsubscribe = createUnsubscribeToken(USER_ID, EMAIL, 'task_assigned');
    expect(verifyVerificationToken(unsubscribe)).toEqual({ status: 'invalid' });
    expect(verifyResetTokenDetailed(unsubscribe)).toEqual({ status: 'invalid' });

    expect(verifyUnsubscribeToken(createVerificationToken(USER_ID, EMAIL))).toEqual({
      status: 'invalid',
    });
    expect(verifyUnsubscribeToken(createResetToken(USER_ID))).toEqual({ status: 'invalid' });
  });
});
