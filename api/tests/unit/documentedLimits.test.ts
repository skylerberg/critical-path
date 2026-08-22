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
// Each row is the constant and the phrase the documents build from it, so a
// constant that moves without its prose fails here rather than being discovered
// by whoever trusted the old figure. Prose can be reworded freely — only the
// fragment naming the number is fixed, and rewording that fragment is the point
// at which someone should be asked to update it.
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const claudeMd = readFileSync(new URL('../../CLAUDE.md', import.meta.url), 'utf8');

interface DocumentedLimit {
  what: string;
  value: number;
  // Built from the value, so the expectation cannot drift from the constant.
  phrase: (value: number) => string;
  documents: Array<{ name: string; text: string }>;
}

const README_ONLY = [{ name: 'README.md', text: readme }];
const BOTH = [
  { name: 'README.md', text: readme },
  { name: 'CLAUDE.md', text: claudeMd },
];

const LIMITS: DocumentedLimit[] = [
  {
    what: 'auth attempts per source address',
    value: AUTH_IP_MAX_ATTEMPTS,
    phrase: (v) => `**${String(v)} an hour per source`,
    documents: README_ONLY,
  },
  {
    what: 'auth attempts per email address',
    value: EMAIL_MAX_ATTEMPTS,
    phrase: (v) => `**${String(v)} per 15 minutes per`,
    documents: README_ONLY,
  },
  {
    what: 'signups per source address',
    value: SIGNUP_IP_MAX_ATTEMPTS,
    phrase: (v) => `**${String(v)} an hour per source IP**`,
    documents: README_ONLY,
  },
  {
    what: 'password resets per source address',
    value: RESET_IP_MAX_ATTEMPTS,
    phrase: (v) => `**${String(v)} an hour per source IP**`,
    documents: README_ONLY,
  },
  {
    what: 'password resets per email address',
    value: RESET_EMAIL_MAX_ATTEMPTS,
    phrase: (v) => `**${String(v)} an hour per email address**`,
    documents: README_ONLY,
  },
  {
    what: 'invitation emails per caller',
    value: INVITE_SEND_MAX_ATTEMPTS,
    phrase: (v) => `**${String(v)} invitation emails an hour, per caller**`,
    documents: README_ONLY,
  },
  {
    what: 'link attachments per user',
    value: LINK_ATTACH_MAX_ATTEMPTS,
    phrase: (v) => `${String(v)} an hour per user`,
    documents: README_ONLY,
  },
  {
    what: 'live sockets per source address',
    value: MAX_SOCKETS_PER_ADDRESS,
    phrase: (v) => `${String(v)} live sockets`,
    documents: BOTH,
  },
  {
    what: 'sockets per account',
    value: MAX_SOCKETS_PER_USER,
    phrase: (v) => `**${String(v)} sockets**`,
    documents: README_ONLY,
  },
  {
    // Worded differently in the two documents, so pinned separately rather than
    // by forcing one of them to read like the other.
    what: 'sockets per account (agent-facing wording)',
    value: MAX_SOCKETS_PER_USER,
    phrase: (v) => `${String(v)} per account`,
    documents: [{ name: 'CLAUDE.md', text: claudeMd }],
  },
  {
    what: 'subscriptions per socket',
    value: MAX_SUBSCRIPTIONS_PER_SOCKET,
    phrase: (v) => `${String(v)} subscriptions`,
    documents: BOTH,
  },
  {
    // Quoted in seconds in all three sentences below, which is how an integrator
    // reads it; the constant is milliseconds because setInterval is.
    what: 'socket heartbeat interval',
    value: HEARTBEAT_INTERVAL_MS,
    phrase: (v) => `every ${String(v / 1000)} seconds`,
    documents: README_ONLY,
  },
  {
    what: 'socket heartbeat interval (token-activity wording)',
    value: HEARTBEAT_INTERVAL_MS,
    phrase: (v) => `${String(v / 1000)}-second heartbeat`,
    documents: README_ONLY,
  },
  {
    what: 'socket heartbeat interval (agent-facing wording)',
    value: HEARTBEAT_INTERVAL_MS,
    phrase: (v) => `heartbeat every ${String(v / 1000)}s`,
    documents: [{ name: 'CLAUDE.md', text: claudeMd }],
  },
];

describe('documented limits match the constants that enforce them', () => {
  for (const limit of LIMITS) {
    for (const document of limit.documents) {
      it(`${document.name} states the ${limit.what}`, () => {
        const expected = limit.phrase(limit.value);
        // Named in the message because a bare "expected true" here reads as a
        // broken test rather than a document that has fallen behind its code.
        expect(
          document.text.includes(expected),
          `${document.name} should contain ${JSON.stringify(expected)} for the ` +
            `${limit.what}. Either the constant moved and the prose did not, or ` +
            `the sentence was reworded — update whichever is now wrong.`
        ).toBe(true);
      });
    }
  }

  // Catches the other direction of drift: lowering a ceiling and leaving the old
  // figure in a sentence the row above does not happen to match.
  it('leaves no stale socket figures behind', () => {
    const superseded = ['500 live sockets', '50 sockets', '100 subscriptions'];
    for (const document of BOTH) {
      for (const stale of superseded) {
        expect(document.text).not.toContain(stale);
      }
    }
  });
});
