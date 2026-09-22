import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  AUTH_IP_MAX_ATTEMPTS,
  EMAIL_MAX_ATTEMPTS,
  INVITE_SEND_MAX_ATTEMPTS,
  LINK_ATTACH_MAX_ATTEMPTS,
  RESET_EMAIL_MAX_ATTEMPTS,
  RESET_IP_MAX_ATTEMPTS,
  SIGNUP_IP_MAX_ATTEMPTS,
} from '../../src/services/rateLimit';
import {
  MAX_SOCKETS_PER_ADDRESS,
  MAX_SOCKETS_PER_USER,
} from '../../src/services/realtime/transport';
import { HEARTBEAT_INTERVAL_MS } from '../../src/services/realtime/heartbeat';
import { MAX_SUBSCRIPTIONS_PER_SOCKET } from '../../src/services/realtime/state';

// Ceilings are the part of the documentation a reader acts on — an operator
// sizing a NAT, an integrator pacing a client — and the part with no compiler
// behind it. The event table in README.md is already pinned to its catalog by
// eventCatalog.test.ts for the same reason; this does the numbers.
//
// README.md is the single owner of these figures — AGENTS.md points at the
// relevant section instead of restating them, which is why only README.md is
// read here. Each row is the constant and the phrase the document builds from
// it, so a constant that moves without its prose fails here rather than being
// discovered by whoever trusted the old figure. Prose can be reworded freely —
// only the fragment naming the number is fixed, and rewording that fragment is
// the point at which someone should be asked to update it.
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const agentsMd = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');

interface DocumentedLimit {
  what: string;
  value: number;
  // Built from the value, so the expectation cannot drift from the constant.
  phrase: (value: number) => string;
}

const LIMITS: DocumentedLimit[] = [
  {
    what: 'auth attempts per source address',
    value: AUTH_IP_MAX_ATTEMPTS,
    phrase: (v) => `**${String(v)} an hour per source`,
  },
  {
    what: 'auth attempts per email address',
    value: EMAIL_MAX_ATTEMPTS,
    phrase: (v) => `**${String(v)} per 15 minutes per`,
  },
  {
    what: 'signups per source address',
    value: SIGNUP_IP_MAX_ATTEMPTS,
    phrase: (v) => `**${String(v)} an hour per source IP**`,
  },
  {
    what: 'password resets per source address',
    value: RESET_IP_MAX_ATTEMPTS,
    phrase: (v) => `**${String(v)} an hour per source IP**`,
  },
  {
    what: 'password resets per email address',
    value: RESET_EMAIL_MAX_ATTEMPTS,
    phrase: (v) => `**${String(v)} an hour per email address**`,
  },
  {
    what: 'invitation emails per caller',
    value: INVITE_SEND_MAX_ATTEMPTS,
    phrase: (v) => `**${String(v)} invitation emails an hour, per caller**`,
  },
  {
    what: 'link attachments per user',
    value: LINK_ATTACH_MAX_ATTEMPTS,
    phrase: (v) => `${String(v)} an hour per user`,
  },
  {
    what: 'live sockets per source address',
    value: MAX_SOCKETS_PER_ADDRESS,
    phrase: (v) => `${String(v)} live sockets`,
  },
  {
    what: 'sockets per account',
    value: MAX_SOCKETS_PER_USER,
    phrase: (v) => `**${String(v)} sockets**`,
  },
  {
    what: 'subscriptions per socket',
    value: MAX_SUBSCRIPTIONS_PER_SOCKET,
    phrase: (v) => `${String(v)} subscriptions`,
  },
  {
    // Quoted in seconds in the prose, which is how an integrator reads it; the
    // constant is milliseconds because setInterval is.
    what: 'socket heartbeat interval',
    value: HEARTBEAT_INTERVAL_MS,
    phrase: (v) => `every ${String(v / 1000)} seconds`,
  },
  {
    what: 'socket heartbeat interval (token-activity wording)',
    value: HEARTBEAT_INTERVAL_MS,
    phrase: (v) => `${String(v / 1000)}-second heartbeat`,
  },
];

describe('documented limits match the constants that enforce them', () => {
  for (const limit of LIMITS) {
    it(`README.md states the ${limit.what}`, () => {
      const expected = limit.phrase(limit.value);
      // Named in the message because a bare "expected true" here reads as a
      // broken test rather than a document that has fallen behind its code.
      expect(
        readme.includes(expected),
        `README.md should contain ${JSON.stringify(expected)} for the ` +
          `${limit.what}. Either the constant moved and the prose did not, or ` +
          `the sentence was reworded — update whichever is now wrong.`
      ).toBe(true);
    });
  }

  // Catches the other direction of drift: lowering a ceiling and leaving the old
  // figure in a sentence the rows above do not happen to match. AGENTS.md is
  // scanned too — it points at the README's sections rather than restating the
  // ceilings, and this negative check is what keeps it that way.
  it('leaves no stale socket figures behind', () => {
    const superseded = ['500 live sockets', '50 sockets', '100 subscriptions'];
    for (const document of [readme, agentsMd]) {
      for (const stale of superseded) {
        expect(document).not.toContain(stale);
      }
    }
  });
});
