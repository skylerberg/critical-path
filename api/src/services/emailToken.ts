import crypto from 'crypto';
import { env } from '../config/env';

export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Domain separation: the secret is shared with the password-reset family, whose
// payloads carry no `t` and so can never satisfy this check.
const TOKEN_TYPE = 'verify';

const EMAIL_HASH_BYTES = 16;

export type VerificationTokenVerification =
  | { status: 'valid'; user_id: string; email_hash: string }
  | { status: 'expired' }
  | { status: 'invalid' };

function sign(payload: string): Buffer {
  return crypto.createHmac('sha256', env.emailTokenSecret).update(payload).digest();
}

// Recomputed from the stored address at redemption, so changing the address
// invalidates every outstanding link with no stored state — and no address ever
// reaches a URL, an access log or a browser history.
export function emailAddressHash(email: string): string {
  return crypto
    .createHash('sha256')
    .update(email.toLowerCase())
    .digest()
    .subarray(0, EMAIL_HASH_BYTES)
    .toString('base64url');
}

export function createVerificationToken(userId: string, email: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({
      t: TOKEN_TYPE,
      uid: userId,
      eh: emailAddressHash(email),
      exp: now + VERIFICATION_TOKEN_TTL_MS,
    })
  ).toString('base64url');
  return `${payload}.${sign(payload).toString('base64url')}`;
}

export function verifyVerificationToken(
  token: string,
  now = Date.now()
): VerificationTokenVerification {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { status: 'invalid' };
  }
  const [payload, signature] = parts;

  const expected = sign(payload);
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { status: 'invalid' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { status: 'invalid' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { status: 'invalid' };
  }
  const { t, uid, eh, exp } = parsed as {
    t?: unknown;
    uid?: unknown;
    eh?: unknown;
    exp?: unknown;
  };
  if (t !== TOKEN_TYPE || typeof uid !== 'string' || typeof eh !== 'string') {
    return { status: 'invalid' };
  }
  if (typeof exp !== 'number') {
    return { status: 'invalid' };
  }

  if (exp <= now) {
    return { status: 'expired' };
  }
  return { status: 'valid', user_id: uid, email_hash: eh };
}
