import crypto from 'crypto';
import { env } from '../config/env';

export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

export type ResetTokenVerification =
  | { status: 'valid'; alternative_id: string }
  | { status: 'expired' }
  | { status: 'invalid' };

function sign(payload: string): Buffer {
  return crypto.createHmac('sha256', env.passwordResetSecret).update(payload).digest();
}

export function createResetToken(alternativeId: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ alternative_id: alternativeId, exp: now + RESET_TOKEN_TTL_MS })
  ).toString('base64url');
  return `${payload}.${sign(payload).toString('base64url')}`;
}

export function verifyResetTokenDetailed(token: string, now = Date.now()): ResetTokenVerification {
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
  const { alternative_id, exp } = parsed as { alternative_id?: unknown; exp?: unknown };
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
