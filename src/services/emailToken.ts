import crypto from 'crypto';
import { type } from 'arktype';
import { env } from '../config/env';
import { notificationKind, type NotificationKind } from '../schemas/notifications';
import { decodeSignedToken, encodeSignedToken } from './signedToken';

export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const VERIFY_TYPE = 'verify';
const UNSUBSCRIBE_TYPE = 'unsubscribe';

const EMAIL_HASH_BYTES = 16;

export type VerificationTokenVerification =
  | { status: 'valid'; user_id: string; email_hash: string }
  | { status: 'expired' }
  | { status: 'invalid' };

export type UnsubscribeTokenVerification =
  | { status: 'valid'; user_id: string; email_hash: string; kind: NotificationKind }
  | { status: 'invalid' };

// Recomputed from the stored address at redemption, so changing the address
// invalidates every outstanding link with no stored state — and no address
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
  return encodeSignedToken(env.emailTokenSecret, VERIFY_TYPE, {
    uid: userId,
    eh: emailAddressHash(email),
    exp: now + VERIFICATION_TOKEN_TTL_MS,
  });
}

export function verifyVerificationToken(
  token: string,
  now = Date.now()
): VerificationTokenVerification {
  const claims = decodeSignedToken(env.emailTokenSecret, VERIFY_TYPE, token);
  if (!claims) {
    return { status: 'invalid' };
  }
  const { uid, eh, exp } = claims;
  if (typeof uid !== 'string' || typeof eh !== 'string' || typeof exp !== 'number') {
    return { status: 'invalid' };
  }

  if (exp <= now) {
    return { status: 'expired' };
  }
  return { status: 'valid', user_id: uid, email_hash: eh };
}

// No expiry: an unsubscribe link has to work in a year-old email, and the only
// thing it authorizes is turning a preference off, so replay is idempotent and a
// leak cannot enable anything. Binding the address supplies the one revocation
// still needed — nothing else retires a token.
export function createUnsubscribeToken(
  userId: string,
  email: string,
  kind: NotificationKind
): string {
  return encodeSignedToken(env.emailTokenSecret, UNSUBSCRIBE_TYPE, {
    uid: userId,
    eh: emailAddressHash(email),
    k: kind,
  });
}

export function verifyUnsubscribeToken(token: string): UnsubscribeTokenVerification {
  const claims = decodeSignedToken(env.emailTokenSecret, UNSUBSCRIBE_TYPE, token);
  if (!claims) {
    return { status: 'invalid' };
  }
  const { uid, eh, k } = claims;
  if (typeof uid !== 'string' || typeof eh !== 'string') {
    return { status: 'invalid' };
  }
  const kind = notificationKind(k);
  if (kind instanceof type.errors) {
    return { status: 'invalid' };
  }
  return { status: 'valid', user_id: uid, email_hash: eh, kind };
}
