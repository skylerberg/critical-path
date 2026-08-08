import crypto from 'crypto';

// Stateless `base64url(claims).base64url(hmac)` tokens, shared by every family
// that mails a link. The type is not a claim the caller remembers to check but
// an argument to both halves, because the families share one secret
// (`emailTokenSecret` falls back to `passwordResetSecret`) and separating them
// is the only thing stopping one family's token from being spent as another's.
const TYPE_CLAIM = 't';

// Reserving the claim in the type keeps a caller from spreading its own `t` over
// the argument and quietly minting a token of a family it did not name.
type TokenClaims = Record<string, unknown> & { [TYPE_CLAIM]?: never };

function sign(secret: string, payload: string): Buffer {
  return crypto.createHmac('sha256', secret).update(payload).digest();
}

export function encodeSignedToken(secret: string, type: string, claims: TokenClaims): string {
  const payload = Buffer.from(JSON.stringify({ [TYPE_CLAIM]: type, ...claims })).toString(
    'base64url'
  );
  return `${payload}.${sign(secret, payload).toString('base64url')}`;
}

export function decodeSignedToken(
  secret: string,
  type: string,
  token: string,
  { acceptUntyped = false }: { acceptUntyped?: boolean } = {}
): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  const [payload, signature] = parts;

  const expected = sign(secret, payload);
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

  const claims = parsed as Record<string, unknown>;
  const claimedType = claims[TYPE_CLAIM];
  if (claimedType === undefined ? !acceptUntyped : claimedType !== type) {
    return null;
  }
  return claims;
}
