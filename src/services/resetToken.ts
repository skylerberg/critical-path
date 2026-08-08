import { env } from '../config/env';
import { decodeSignedToken, encodeSignedToken } from './signedToken';

export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

const RESET_TYPE = 'reset';

export type ResetTokenVerification =
  | { status: 'valid'; alternative_id: string }
  | { status: 'expired' }
  | { status: 'invalid' };

export function createResetToken(alternativeId: string, now = Date.now()): string {
  return encodeSignedToken(env.passwordResetSecret, RESET_TYPE, {
    alternative_id: alternativeId,
    exp: now + RESET_TOKEN_TTL_MS,
  });
}

export function verifyResetTokenDetailed(token: string, now = Date.now()): ResetTokenVerification {
  const claims = decodeSignedToken(env.passwordResetSecret, RESET_TYPE, token);
  if (!claims) {
    return { status: 'invalid' };
  }
  const { alternative_id, exp } = claims;
  if (typeof alternative_id !== 'string' || typeof exp !== 'number') {
    return { status: 'invalid' };
  }

  if (exp <= now) {
    return { status: 'expired' };
  }
  return { status: 'valid', alternative_id };
}

export function verifyResetToken(
  token: string,
  now = Date.now()
): { alternative_id: string } | null {
  const result = verifyResetTokenDetailed(token, now);
  return result.status === 'valid' ? { alternative_id: result.alternative_id } : null;
}
