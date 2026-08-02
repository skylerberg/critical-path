import { APP_NAME } from '../config/constants';
import { env } from '../config/env';
import { db } from '../db/index';
import { logger } from '../utils/logger';
import { getEmailSender } from './email/index';
import { createUnsubscribeToken } from './emailToken';
import type { EmailMessage } from './email/types';
import type { NotificationKind } from '../schemas/notifications';
import type { AppContext } from '../types/index';

// Membership already bounds who can be notified; this bounds the fan-out of a
// single write on a project with a large membership.
export const MAX_NOTIFICATION_RECIPIENTS = 100;

export const NOTIFY_COLUMN = {
  task_assigned: 'notify_task_assigned',
  added_to_project: 'notify_added_to_project',
} as const satisfies Record<NotificationKind, string>;

export interface Notification {
  kind: NotificationKind;
  actorName: string;
  project: { id: string; name: string };
  task?: { id: string; title: string };
  recipientUserIds: string[];
}

interface Recipient {
  id: string;
  email: string;
  name: string;
}

function unsubscribeLinks(
  recipientId: string,
  kind: NotificationKind
): {
  page: string;
  oneClick: string;
} {
  // The web app and this service share an origin, so the app's base is also
  // what a mail client has to post back to.
  const token = encodeURIComponent(createUnsubscribeToken(recipientId, kind));
  return {
    page: `${env.appUrlBase}/unsubscribe?token=${token}`,
    oneClick: `${env.appUrlBase}/api/auth/unsubscribe/one-click?token=${token}`,
  };
}

function messageFor(notification: Notification, recipient: Recipient): EmailMessage {
  const { page, oneClick } = unsubscribeLinks(recipient.id, notification.kind);
  const subject =
    notification.task === undefined
      ? `${notification.actorName} added you to ${notification.project.name}`
      : `${notification.actorName} assigned you: ${notification.task.title}`;
  const body =
    notification.task === undefined
      ? `${notification.actorName} added you to the board "${notification.project.name}" on ${APP_NAME}.\n\n` +
        `Open it here: ${env.appUrlBase}/projects/${notification.project.id}`
      : `${notification.actorName} assigned you "${notification.task.title}" on the board ` +
        `"${notification.project.name}".\n\n` +
        `Open it here: ${env.appUrlBase}/projects/${notification.project.id}/tasks/${notification.task.id}`;

  return {
    to: recipient.email,
    subject,
    text: `${body}\n\nTo stop receiving these emails: ${page}\n`,
    headers: {
      'List-Unsubscribe': `<${oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

// The single seam where notification delivery attaches, so a test can assert
// what would be sent without intercepting email.
export const notificationDelivery: {
  deliver: (notification: Notification) => Promise<void>;
} = {
  deliver: async (notification) => {
    // The module-level connection, not the request's: by the time a post-commit
    // hook runs its transaction is closed.
    //
    // Both gates are one predicate per recipient row: below every call site so
    // account-access mail cannot be caught by them, and per-row so one
    // unverified recipient never suppresses mail to the rest.
    const recipients = await db
      .selectFrom('app_user')
      .select(['id', 'email', 'name'])
      .where('id', 'in', notification.recipientUserIds)
      .where('email_verified_at', 'is not', null)
      .where(NOTIFY_COLUMN[notification.kind], '=', true)
      .execute();

    const sender = getEmailSender();
    const results = await Promise.allSettled(
      recipients.map((recipient) => sender.send(messageFor(notification, recipient)))
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error({
          msg: 'Notification email failed',
          kind: notification.kind,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  },
};

export async function notify(
  c: Pick<AppContext, 'get'>,
  args: {
    kind: NotificationKind;
    actor: { id: string; name: string };
    project: { id: string; name: string };
    taskId?: string;
    recipientUserIds: string[];
  }
): Promise<void> {
  // The actor rule lives here rather than at the call sites so that every
  // future kind inherits it: acting on yourself never mails you.
  const recipientUserIds = [...new Set(args.recipientUserIds)]
    .filter((id) => id !== args.actor.id)
    .slice(0, MAX_NOTIFICATION_RECIPIENTS);
  if (recipientUserIds.length === 0) return;

  let task: { id: string; title: string } | undefined;
  if (args.taskId !== undefined) {
    const row = await c
      .get('db')
      .selectFrom('task')
      .select(['id', 'title'])
      .where('id', '=', args.taskId)
      .executeTakeFirst();
    if (!row) return;
    task = row;
  }

  const notification: Notification = {
    kind: args.kind,
    actorName: args.actor.name,
    project: { id: args.project.id, name: args.project.name },
    task,
    recipientUserIds,
  };
  c.get('postCommitHooks').push(() => notificationDelivery.deliver(notification));
}
