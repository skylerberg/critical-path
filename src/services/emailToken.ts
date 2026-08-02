import crypto from 'crypto';
import { type } from 'arktype';
import { env } from '../config/env';
import { notificationKind, type NotificationKind } from '../schemas/notifications';

export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Domain separation: the secret is shared with the password-reset family, whose
// payloads carry no `t` and so can never satisfy either check below.
const VERIFY_TYPE = 'verify';
const UNSUBSCRIBE_TYPE = 'unsubscribe';

const EMAIL_HASH_BYTES = 16;

export type VerificationTokenVerification =
  | { status: 'valid'; user_id: string; email_hash: string }
  | { status: 'expired' }
  | { status: 'invalid' };

export type UnsubscribeTokenVerification =
  | { status: 'valid'; user_id: string; kind: NotificationKind }
  | { status: 'invalid' };

function sign(payload: string): Buffer {
  return crypto.createHmac('sha256', env.emailTokenSecret).update(payload).digest();
}

function encode(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(payload).toString('base64url')}`;
}

function decode(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  const [payload, signature] = parts;

  const expected = sign(payload);
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
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
  return encode({
    t: VERIFY_TYPE,
    uid: userId,
    eh: emailAddressHash(email),
    exp: now + VERIFICATION_TOKEN_TTL_MS,
  });
}

export function verifyVerificationToken(
  token: string,
  now = Date.now()
): VerificationTokenVerification {
  const claims = decode(token);
  if (!claims) {
    return { status: 'invalid' };
  }
  const { t, uid, eh, exp } = claims;
  if (t !== VERIFY_TYPE || typeof uid !== 'string' || typeof eh !== 'string') {
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

// No expiry: an unsubscribe link has to work in a year-old email, and the only
// thing it authorizes is turning a preference off, so replay is idempotent and
// a leak cannot enable anything.
export function createUnsubscribeToken(userId: string, kind: NotificationKind): string {
  return encode({ t: UNSUBSCRIBE_TYPE, uid: userId, k: kind });
}

export function verifyUnsubscribeToken(token: string): UnsubscribeTokenVerification {
  const claims = decode(token);
  if (!claims) {
    return { status: 'invalid' };
  }
  const { t, uid, k } = claims;
  if (t !== UNSUBSCRIBE_TYPE || typeof uid !== 'string') {
    return { status: 'invalid' };
  }
  const kind = notificationKind(k);
  if (kind instanceof type.errors) {
    return { status: 'invalid' };
  }
  return { status: 'valid', user_id: uid, kind };
}
