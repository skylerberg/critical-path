import { APP_NAME } from '../config/constants';
import { projectLink, taskLink, unsubscribeLink, unsubscribeOneClickUrl } from './webLinks';
import { db } from '../db/index';
import { withNotificationBudget } from './notificationBudget';
import { errorText } from '../utils/errors';
import { logger } from '../utils/logger';
import { projectAccessIdsAmong, type ProjectAccessFields } from './authorization';
import { getEmailSender } from './email/index';
import { createUnsubscribeToken } from './emailToken';
import type { EmailMessage } from './email/types';
import type { NotificationKind } from '../schemas/notifications';
import type { PublicContext } from '../types/index';

// Membership already bounds who can be notified; this bounds the fan-out of a
// single write on a project with a large membership.
export const MAX_NOTIFICATION_RECIPIENTS = 100;

export const NOTIFY_COLUMN = {
  task_assigned: 'notify_task_assigned',
  added_to_project: 'notify_added_to_project',
  bulk_task_assigned: 'notify_bulk_task_assigned',
} as const satisfies Record<NotificationKind, string>;

export const NOTIFICATION_KINDS = Object.keys(NOTIFY_COLUMN) as NotificationKind[];

export interface Notification {
  kind: NotificationKind;
  actor: { id: string; name: string };
  project: { id: string; name: string; created_by: string | null };
  task?: { id: string; title: string };
  recipientUserIds: string[];
}

export interface Recipient {
  id: string;
  email: string;
  name: string;
}

// Both mailers gate on the same three things, and the access re-check is
// deliberately the last of them: every caller runs after its transaction
// committed, so access can have been revoked in between.
export async function eligibleRecipients(
  kind: NotificationKind,
  project: ProjectAccessFields,
  userIds: readonly string[]
): Promise<Recipient[]> {
  const rows = await db
    .selectFrom('app_user')
    .select(['id', 'email', 'name'])
    .where('id', 'in', [...userIds])
    .where('email_verified_at', 'is not', null)
    .where(NOTIFY_COLUMN[kind], '=', true)
    .execute();
  if (rows.length === 0) return [];

  const accessible = new Set(
    await projectAccessIdsAmong(
      db,
      project,
      rows.map((recipient) => recipient.id)
    )
  );
  return rows.filter((recipient) => accessible.has(recipient.id));
}

// Deliberately no actor: otherwise a loop only has to alternate who performs
// the write to make every message look new.
function repeatKey(notification: Notification): string {
  return `${notification.kind}:${notification.project.id}:${notification.task?.id ?? ''}`;
}

// `headers` rather than the one-click URL it wraps, so no mailer can build a
// message that carries the footer link without the RFC 8058 header pair.
export function unsubscribeLinks(
  recipient: { id: string; email: string },
  kind: NotificationKind
): {
  page: string;
  headers: Record<string, string>;
} {
  // The web app and this service share an origin, so the app's base is also
  // what a mail client has to post back to.
  const token = encodeURIComponent(createUnsubscribeToken(recipient.id, recipient.email, kind));
  return {
    page: unsubscribeLink(token),
    headers: {
      'List-Unsubscribe': `<${unsubscribeOneClickUrl(token)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

function messageFor(notification: Notification, recipient: Recipient): EmailMessage {
  const { page, headers } = unsubscribeLinks(recipient, notification.kind);
  const subject =
    notification.task === undefined
      ? `${notification.actor.name} added you to ${notification.project.name}`
      : `${notification.actor.name} assigned you: ${notification.task.title}`;
  const body =
    notification.task === undefined
      ? `${notification.actor.name} added you to the board "${notification.project.name}" on ${APP_NAME}.\n\n` +
        `Open it here: ${projectLink(notification.project.id)}`
      : `${notification.actor.name} assigned you "${notification.task.title}" on the board ` +
        `"${notification.project.name}".\n\n` +
        `Open it here: ${taskLink(notification.project.id, notification.task.id)}`;

  return {
    to: recipient.email,
    subject,
    text: `${body}\n\nTo stop receiving these emails: ${page}\n`,
    headers,
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
    // Every gate here is per recipient, so one unverified, opted-out,
    // since-evicted or throttled recipient never suppresses mail to the rest.
    const recipients = await eligibleRecipients(
      notification.kind,
      notification.project,
      notification.recipientUserIds
    );

    const sender = getEmailSender();
    const key = repeatKey(notification);
    const results = await Promise.allSettled(
      recipients.map((recipient) =>
        withNotificationBudget(recipient.id, notification.actor.id, key, () =>
          sender.send(messageFor(notification, recipient))
        )
      )
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error({
          msg: 'Notification email failed',
          kind: notification.kind,
          error: errorText(result.reason),
        });
      }
    }
  },
};

export async function notify(
  c: Pick<PublicContext, 'get'>,
  args: {
    kind: NotificationKind;
    actor: { id: string; name: string };
    project: { id: string; name: string; created_by: string | null };
    taskId?: string;
    recipientUserIds: string[];
  }
): Promise<void> {
  // Here rather than at the call sites so every future kind inherits it: acting
  // on yourself never mails you.
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
    actor: { id: args.actor.id, name: args.actor.name },
    project: {
      id: args.project.id,
      name: args.project.name,
      created_by: args.project.created_by,
    },
    task,
    recipientUserIds,
  };
  c.get('postCommitHooks').push(() => notificationDelivery.deliver(notification));
}
