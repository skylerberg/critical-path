import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MAX_NOTIFICATION_RECIPIENTS,
  notificationDelivery,
  notify,
  type Notification,
} from '../../src/services/notifications';
import type { AppContext } from '../../src/types/index';

const ACTOR = { id: 'actor-id', name: 'Actor' };
const PROJECT = { id: 'project-id', name: 'Board', created_by: ACTOR.id };

const realDeliver = notificationDelivery.deliver;
const delivered: Notification[] = [];
let hooks: Array<() => Promise<void>> = [];

// Only 'postCommitHooks' is ever read for a kind that carries no task, so a
// stub is enough to exercise the layer's own rules without a database.
const context = {
  get: (key: string) => {
    if (key === 'postCommitHooks') return hooks;
    throw new Error(`Unexpected context key: ${key}`);
  },
} as unknown as Pick<AppContext, 'get'>;

async function runHooks(): Promise<void> {
  for (const hook of hooks) {
    await hook();
  }
}

beforeEach(() => {
  hooks = [];
  delivered.length = 0;
  notificationDelivery.deliver = async (notification) => {
    delivered.push(notification);
  };
});

afterEach(() => {
  notificationDelivery.deliver = realDeliver;
});

describe('notify', () => {
  it('drops the actor from their own action', async () => {
    await notify(context, {
      kind: 'added_to_project',
      actor: ACTOR,
      project: PROJECT,
      recipientUserIds: [ACTOR.id, 'someone-else'],
    });
    await runHooks();

    expect(delivered).toHaveLength(1);
    expect(delivered[0].recipientUserIds).toEqual(['someone-else']);
  });

  it('pushes no hook at all when the actor was the only recipient', async () => {
    await notify(context, {
      kind: 'added_to_project',
      actor: ACTOR,
      project: PROJECT,
      recipientUserIds: [ACTOR.id],
    });

    expect(hooks).toHaveLength(0);
  });

  it('pushes no hook for an empty recipient list', async () => {
    await notify(context, {
      kind: 'added_to_project',
      actor: ACTOR,
      project: PROJECT,
      recipientUserIds: [],
    });

    expect(hooks).toHaveLength(0);
  });

  it('mails a repeated recipient once', async () => {
    await notify(context, {
      kind: 'added_to_project',
      actor: ACTOR,
      project: PROJECT,
      recipientUserIds: ['dup', 'dup', 'dup'],
    });
    await runHooks();

    expect(delivered[0].recipientUserIds).toEqual(['dup']);
  });

  it('caps the fan-out of one write', async () => {
    const many = Array.from(
      { length: MAX_NOTIFICATION_RECIPIENTS + 25 },
      (_unused, index) => `user-${String(index)}`
    );

    await notify(context, {
      kind: 'added_to_project',
      actor: ACTOR,
      project: PROJECT,
      recipientUserIds: many,
    });
    await runHooks();

    expect(delivered[0].recipientUserIds).toHaveLength(MAX_NOTIFICATION_RECIPIENTS);
  });
});
