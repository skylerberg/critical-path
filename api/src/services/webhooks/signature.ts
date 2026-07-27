import crypto from 'crypto';

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// The timestamp is inside the signed string so a captured delivery cannot be
// replayed under a fresh one.
export function signWebhookBody(secret: string, timestampSeconds: number, body: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${String(timestampSeconds)}.${body}`)
    .digest('hex');
}
