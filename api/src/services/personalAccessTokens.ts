import crypto from 'crypto';

export const PERSONAL_ACCESS_TOKEN_PREFIX = 'cpat_';
export const MAX_PERSONAL_ACCESS_TOKENS_PER_USER = 100;

export function generatePersonalAccessToken(): string {
  return PERSONAL_ACCESS_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

export function isPersonalAccessToken(token: string): boolean {
  return token.startsWith(PERSONAL_ACCESS_TOKEN_PREFIX);
}
