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
import type { MentionSource } from './mentions';
import type {
  NotificationKind,
  NotificationSettings,
  NotificationSettingsUpdate,
} from '../schemas/notifications';
import type { PublicContext } from '../types/index';

// Membership already bounds who can be notified; this bounds the fan-out of a
// single write on a project with a large membership.
export const MAX_NOTIFICATION_RECIPIENTS = 100;

export const NOTIFY_COLUMN = {
  task_assigned: 'notify_task_assigned',
  added_to_project: 'notify_added_to_project',
  bulk_task_assigned: 'notify_bulk_task_assigned',
  mentioned: 'notify_mentioned',
} as const satisfies Record<NotificationKind, string>;

export type NotifyColumn = (typeof NOTIFY_COLUMN)[NotificationKind];

export const NOTIFICATION_KINDS = Object.keys(NOTIFY_COLUMN) as NotificationKind[];

// Everything that reads or writes the preferences goes through these two, so a
// new kind is the `NOTIFY_COLUMN` row and its migration and nothing else.
export const NOTIFY_COLUMNS: NotifyColumn[] = NOTIFICATION_KINDS.map((kind) => NOTIFY_COLUMN[kind]);

export function toNotificationSettings(row: Record<NotifyColumn, boolean>): NotificationSettings {
  return Object.fromEntries(
    NOTIFICATION_KINDS.map((kind) => [kind, row[NOTIFY_COLUMN[kind]]])
  ) as NotificationSettings;
}

export function toNotifyColumns(
  settings: NotificationSettingsUpdate
): Partial<Record<NotifyColumn, boolean>> {
  const changes: Partial<Record<NotifyColumn, boolean>> = {};
  for (const kind of NOTIFICATION_KINDS) {
    const value = settings[kind];
    if (value !== undefined) {
      changes[NOTIFY_COLUMN[kind]] = value;
    }
  }
  return changes;
}

interface NotificationTarget {
  actor: { id: string; name: string };
  project: { id: string; name: string; created_by: string | null };
  recipientUserIds: string[];
}

// A union rather than one shape with optional parts, so `messageFor` cannot be
// handed a kind whose message it has nothing to build from. `bulk_task_assigned`
// is absent on purpose: it never reaches this layer, because a digest coalesces
// many cards into one message of its own in ./assignmentDigest.
export type Notification = NotificationTarget &
  (
    | { kind: 'added_to_project'; task?: undefined; source?: undefined }
    | { kind: 'task_assigned'; task: { id: string; title: string }; source?: undefined }
    | { kind: 'mentioned'; task: { id: string; title: string }; source: MentionSource }
  );

export interface Recipient {
  id: string;
  email: string;
  name: string;
}

// Both mailers gate on the same four things, and the access re-check is
// deliberately the last of them: every caller runs after its transaction
// committed, so access can have been revoked in between.
//
// This is the one gate every mailer passes through, so the two rules that bound
// who a single write can reach live here rather than only in `notify`: the actor
// is dropped, and what is left is capped. `notify` applies both again before it
// queues anything, but a publisher that builds its own `Notification` and calls
// `notificationDelivery.deliver` runs none of that — and "acting on yourself
// never mails you" and "one write mails at most a hundred people" have to hold
// for those as well. `actorUserId` is a required argument for the same reason: a
// mailer cannot forget to pass what it has no choice about.
//
// Both bound the ids asked for rather than the ones that survive the gates
// below, so naming 150 people of whom 60 are unverified mails 40 and not 100.
// That keeps the ceiling a bound on the fan-out of one write, which is the thing
// worth bounding, rather than a quota to be filled.
export async function eligibleRecipients(
  kind: NotificationKind,
  project: ProjectAccessFields,
  actorUserId: string,
  userIds: readonly string[]
): Promise<Recipient[]> {
  const wanted = [...new Set(userIds)]
    .filter((id) => id !== actorUserId)
    .slice(0, MAX_NOTIFICATION_RECIPIENTS);
  if (wanted.length === 0) return [];

  const rows = await db
    .selectFrom('app_user')
    .select(['id', 'email', 'name'])
    .where('id', 'in', wanted)
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

function contentFor(notification: Notification): { subject: string; body: string } {
  const actor = notification.actor.name;
  const board = notification.project.name;
  switch (notification.kind) {
    case 'added_to_project':
      return {
        subject: `${actor} added you to ${board}`,
        body:
          `${actor} added you to the board "${board}" on ${APP_NAME}.\n\n` +
          `Open it here: ${projectLink(notification.project.id)}`,
      };
    case 'task_assigned':
      return {
        subject: `${actor} assigned you: ${notification.task.title}`,
        body:
          `${actor} assigned you "${notification.task.title}" on the board "${board}".\n\n` +
          `Open it here: ${taskLink(notification.project.id, notification.task.id)}`,
      };
    case 'mentioned': {
      // A comment has no link of its own — the card is the finest thing
      // ./webLinks can address — so the sentence is what says where to look.
      const where =
        notification.source === 'comment'
          ? `in a comment on "${notification.task.title}"`
          : `in the description of "${notification.task.title}"`;
      return {
        subject: `${actor} mentioned you in ${notification.task.title}`,
        body:
          `${actor} mentioned you ${where} on the board "${board}".\n\n` +
          `Open it here: ${taskLink(notification.project.id, notification.task.id)}`,
      };
    }
  }
}

function messageFor(notification: Notification, recipient: Recipient): EmailMessage {
  const { page, headers } = unsubscribeLinks(recipient, notification.kind);
  const { subject, body } = contentFor(notification);

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
      notification.actor.id,
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

export type NotifyArgs = {
  actor: { id: string; name: string };
  project: { id: string; name: string; created_by: string | null };
  recipientUserIds: string[];
} & (
  | { kind: 'added_to_project'; taskId?: undefined; source?: undefined }
  | { kind: 'task_assigned'; taskId: string; source?: undefined }
  | { kind: 'mentioned'; taskId: string; source: MentionSource }
);

export async function notify(c: Pick<PublicContext, 'get'>, args: NotifyArgs): Promise<void> {
  // Both rules are applied again in `eligibleRecipients`, which is what makes
  // them hold for every mailer. Applying them here as well is what makes a write
  // naming only yourself queue no hook at all, and what keeps the hundred ids
  // this hands on from being a different hundred than the ones that get mail.
  const recipientUserIds = [...new Set(args.recipientUserIds)]
    .filter((id) => id !== args.actor.id)
    .slice(0, MAX_NOTIFICATION_RECIPIENTS);
  if (recipientUserIds.length === 0) return;

  const target: NotificationTarget = {
    actor: { id: args.actor.id, name: args.actor.name },
    project: {
      id: args.project.id,
      name: args.project.name,
      created_by: args.project.created_by,
    },
    recipientUserIds,
  };

  let notification: Notification;
  if (args.kind === 'added_to_project') {
    notification = { ...target, kind: args.kind };
  } else {
    const task = await c
      .get('db')
      .selectFrom('task')
      .select(['id', 'title'])
      .where('id', '=', args.taskId)
      .executeTakeFirst();
    if (!task) return;
    notification =
      args.kind === 'mentioned'
        ? { ...target, kind: args.kind, task, source: args.source }
        : { ...target, kind: args.kind, task };
  }

  c.get('postCommitHooks').push(() => notificationDelivery.deliver(notification));
}
