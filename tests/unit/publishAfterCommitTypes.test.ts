import { describe, it, expect } from 'vitest';
import { ACCOUNT_UPDATED, USER_UPDATED, publishAfterCommit } from '../../src/services/realtime/bus';
import type { PublicContext } from '../../src/types/index';

// A compile-time test. Every misuse below is silent at runtime — the entry is
// published, no branch claims it, and it reaches nobody — so the only place it
// can be caught is here, and the only thing that can catch it is the type
// checker. Each @ts-expect-error is the assertion: if an overload is ever
// widened enough to accept one of these calls, the directive stops suppressing
// anything and `pnpm run type-check` fails on the unused directive.
//
// Nothing is executed; the calls sit behind a false guard so the file still
// runs as an ordinary test file.

declare const c: Pick<PublicContext, 'get'>;

const me = {
  id: 'u1',
  name: 'Me',
  avatar_url: null,
  email: 'me@example.com',
  email_verified: true,
};
const publicUser = { id: 'u1', name: 'Me', avatar_url: null };

function misuses(): void {
  // A namedRecipients type with no recipient list falls through to
  // deliverProjectScoped, which returns on the null project id.
  // @ts-expect-error account_updated must carry recipientUserIds
  publishAfterCommit(c, ACCOUNT_UPDATED, null, me);

  // A dispatched type with one would take the exact-recipient shortcut and skip
  // the branch that is supposed to decide its audience.
  // @ts-expect-error user_updated must not carry recipientUserIds
  publishAfterCommit(c, USER_UPDATED, null, publicUser, { recipientUserIds: ['u1'] });

  // Both project-scoped options route through deliverProjectScoped too.
  // @ts-expect-error broadcast is not an account-event option
  publishAfterCommit(c, ACCOUNT_UPDATED, null, me, { recipientUserIds: ['u1'], broadcast: true });
  // @ts-expect-error editorsOnly is not an account-event option
  publishAfterCommit(c, ACCOUNT_UPDATED, null, me, { recipientUserIds: ['u1'], editorsOnly: true });

  // An account event published against a project, and a project event with no
  // project, each skip the dot and the webhook queue.
  // @ts-expect-error account events carry no project id
  publishAfterCommit(c, ACCOUNT_UPDATED, 'p1', me, { recipientUserIds: ['u1'] });
  // @ts-expect-error project events require a project id
  publishAfterCommit(c, 'task_deleted', null, { id: 't1' });
}

describe('publishAfterCommit call shapes', () => {
  it('rejects every publish that would reach nobody', () => {
    // The @ts-expect-error directives above are the test. This only pins that
    // the misuses are never actually run.
    expect(typeof misuses).toBe('function');
  });
});
