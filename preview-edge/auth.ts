import { createHash, timingSafeEqual } from 'node:crypto';

// The value terraform writes into the PREVIEW_AUTH secret so the Cloud Run
// revision has a version to mount. The real credential is added out of band —
// see the "Preview auth" section of infra/terraform/README.md. Recognised here
// so that a placeholder whose value is in the repository can never be
// presented back as a credential.
export const PLACEHOLDER_CREDENTIAL = 'preview-auth-not-configured';

// RFC 7235 makes the scheme token case-insensitive, and the separator is one
// or more spaces.
const BASIC = /^Basic +/i;

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

// HTTP Basic gate for the preview hosts, and deliberately fail-closed: a
// preview is an unreviewed build on a guessable public subdomain whose /api,
// /ws and /health route to the production API and its real data. A missing,
// empty or still-placeholder credential therefore denies every request rather
// than admitting it. That direction is the point of the change — the previous
// `if (!PREVIEW_AUTH) return true` meant an unset secret opened production
// data to the internet and reported nothing, where a fail-closed gate surfaces
// the same misconfiguration as a 401 on a preview link nobody can open.
export function authorized(header: string | undefined, expected: string | undefined): boolean {
  if (!expected || expected === PLACEHOLDER_CREDENTIAL) return false;
  if (!header || !BASIC.test(header)) return false;
  // Buffer.from(_, 'base64') skips characters outside the alphabet instead of
  // throwing, so a malformed payload simply decodes to something that does not
  // match. Nothing below can throw on attacker-controlled input.
  const presented = Buffer.from(header.replace(BASIC, ''), 'base64').toString('utf8');
  // Digests rather than the strings themselves: timingSafeEqual throws when
  // its arguments differ in length, and these are always 32 bytes. That also
  // keeps the credential's length out of the timing, not just its bytes.
  return timingSafeEqual(digest(presented), digest(expected));
}
