import crypto from 'crypto';
import { sql } from 'kysely';
import { APP_NAME } from '../config/constants';
import { projectLink, taskLink } from './webLinks';
import { db } from '../db/index';
import { withNotificationBudget } from './notificationBudget';
import { errorText } from '../utils/errors';
import { logger } from '../utils/logger';
import { getEmailSender } from './email/index';
import { registerJobHandler } from './jobs/handlers';
import { eligibleRecipients, unsubscribeLinks } from './notifications';
import type { EmailMessage } from './email/types';
import type { PublicContext } from '../types/index';

const ASSIGNMENT_DIGEST_JOB_KIND = 'assignment_digest';
const DIGEST_SWEEP_INTERVAL_SECONDS = 30;
const DIGEST_SWEEP_TIMEOUT_MS = 15_000;
const DIGEST_SWEEP_BUDGET_MS = 10_000;
const DIGEST_SWEEP_BATCH = 50;

// The group waits for its sender to stop rather than for a fixed delay after the
// first card, so a second bulk assign a minute later joins the same message.
const DIGEST_QUIET_SECONDS = 120;
// …but a sender who keeps going never lets it settle, so the wait is capped.
const DIGEST_MAX_WAIT_SECONDS = 900;

// Bounds the id list a single flush resolves; the remainder flushes next tick.
export const DIGEST_MAX_TASKS = 500;
const TITLES_IN_EMAIL = 5;
const MAX_TITLE_CHARS = 120;

// Titles and board names may carry newlines, and a bullet list a card title can
// break out of is an unsubscribe footer a card title can forge.
function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/gu, ' ').trim();
  return collapsed.length > MAX_TITLE_CHARS
    ? `${collapsed.slice(0, MAX_TITLE_CHARS - 1)}…`
    : collapsed;
}

export interface AssignmentDigest {
  recipientUserId: string;
  actorUserId: string;
  projectId: string;
  taskIds: string[];
}

interface DigestGroup {
  recipient_user_id: string;
  actor_user_id: string;
  project_id: string;
}

/**
 * Takes the caller's connection so the pending rows commit or roll back with
 * the assignment that caused them.
 */
export async function recordBulkAssignments(
  c: Pick<PublicContext, 'get'>,
  args: {
    actorUserId: string;
    projectId: string;
    pairs: readonly { task_id: string; user_id: string }[];
  }
): Promise<void> {
  const rows = [
    ...new Map(
      args.pairs
        .filter((pair) => pair.user_id !== args.actorUserId)
        .map((pair) => [
          `${pair.user_id}:${pair.task_id}`,
          {
            recipient_user_id: pair.user_id,
            actor_user_id: args.actorUserId,
            project_id: args.projectId,
            task_id: pair.task_id,
          },
        ])
    ).values(),
  ];
  if (rows.length === 0) return;

  await c
    .get('db')
    .insertInto('pending_assignment_notification')
    .values(rows)
    .onConflict((oc) =>
      oc.columns(['recipient_user_id', 'actor_user_id', 'project_id', 'task_id']).doNothing()
    )
    .execute();
}

async function dueGroups(limit: number): Promise<DigestGroup[]> {
  const { rows } = await sql<DigestGroup>`
    select recipient_user_id, actor_user_id, project_id
    from pending_assignment_notification
    group by recipient_user_id, actor_user_id, project_id
    having max(created_at) <= now() - make_interval(secs => ${sql.lit(DIGEST_QUIET_SECONDS)})
        or min(created_at) <= now() - make_interval(secs => ${sql.lit(DIGEST_MAX_WAIT_SECONDS)})
    order by min(created_at)
    limit ${limit}
  `.execute(db);
  return rows;
}

/**
 * Takes the group's pending rows away under a lock, so a second replica sweeping
 * the same group finds nothing rather than sending the message twice. The rows
 * are gone whatever the gates downstream decide: a recipient who has switched
 * the kind off must not accumulate a queue forever.
 */
async function claimDigest(group: DigestGroup): Promise<AssignmentDigest | null> {
  return db.transaction().execute(async (trx) => {
    const claimed = await trx
      .selectFrom('pending_assignment_notification')
      .select('task_id')
      .where('recipient_user_id', '=', group.recipient_user_id)
      .where('actor_user_id', '=', group.actor_user_id)
      .where('project_id', '=', group.project_id)
      .orderBy('created_at')
      .orderBy('task_id')
      .limit(DIGEST_MAX_TASKS)
      .forUpdate()
      .skipLocked()
      .execute();
    if (claimed.length === 0) return null;

    const taskIds = claimed.map((row) => row.task_id);
    await trx
      .deleteFrom('pending_assignment_notification')
      .where('recipient_user_id', '=', group.recipient_user_id)
      .where('actor_user_id', '=', group.actor_user_id)
      .where('project_id', '=', group.project_id)
      .where('task_id', 'in', taskIds)
      .execute();

    return {
      recipientUserId: group.recipient_user_id,
      actorUserId: group.actor_user_id,
      projectId: group.project_id,
      taskIds,
    };
  });
}

function digestMessage(
  recipient: { id: string; email: string },
  actorName: string,
  project: { id: string; name: string },
  tasks: { id: string; title: string }[]
): EmailMessage {
  const { page, headers } = unsubscribeLinks(recipient, 'bulk_task_assigned');
  const actor = oneLine(actorName);
  const board = oneLine(project.name);
  const count = tasks.length;
  const cards = count === 1 ? 'a card' : `${String(count)} cards`;
  const listed = tasks.slice(0, TITLES_IN_EMAIL);
  const remaining = count - listed.length;
  const target =
    count === 1 && tasks[0] !== undefined
      ? taskLink(project.id, tasks[0].id)
      : projectLink(project.id);

  const lines = [
    `${actor} assigned you ${cards} on the board "${board}" on ${APP_NAME}.`,
    '',
    ...listed.map((task) => `- ${oneLine(task.title)}`),
    ...(remaining > 0 ? [`- and ${String(remaining)} more`] : []),
    '',
    `Open ${count === 1 ? 'it' : 'the board'} here: ${target}`,
  ];

  return {
    to: recipient.email,
    subject: `${actor} assigned you ${cards} in ${board}`,
    text: `${lines.join('\n')}\n\nTo stop receiving these emails: ${page}\n`,
    headers,
  };
}

// Not the group key: two different sets of cards from the same person on the
// same board are two different things to say.
function repeatKey(projectId: string, taskIds: string[]): string {
  const fingerprint = crypto
    .createHash('sha256')
    .update([...taskIds].sort().join(','))
    .digest('base64url')
    .slice(0, 22);
  return `bulk_task_assigned:${projectId}:${fingerprint}`;
}

// The single seam where digest delivery attaches, so a test can assert what
// would be sent without intercepting email.
export const assignmentDigestDelivery: {
  deliver: (digest: AssignmentDigest) => Promise<void>;
} = {
  deliver: async (digest) => {
    // Every gate is re-evaluated rather than trusted from the write that queued
    // the rows: the window is minutes wide, and access, assignment and the
    // preference itself can all have moved inside it.
    const project = await db
      .selectFrom('project')
      .select(['id', 'name', 'created_by'])
      .where('id', '=', digest.projectId)
      .executeTakeFirst();
    if (!project) return;

    const [recipient] = await eligibleRecipients('bulk_task_assigned', project, [
      digest.recipientUserId,
    ]);
    if (recipient === undefined) return;

    const actor = await db
      .selectFrom('app_user')
      .select('name')
      .where('id', '=', digest.actorUserId)
      .executeTakeFirst();
    if (!actor) return;

    // Cards archived or unassigned since are dropped, so the count the message
    // claims is the count the board would show. Listed in board order.
    const tasks = await db
      .selectFrom('task')
      .innerJoin('task_assignee', (join) =>
        join
          .onRef('task_assignee.task_id', '=', 'task.id')
          .on('task_assignee.user_id', '=', recipient.id)
      )
      .select(['task.id', 'task.title'])
      .where('task.id', 'in', digest.taskIds)
      .where('task.project_id', '=', project.id)
      .where('task.archived_at', 'is', null)
      .orderBy('task.sort_key')
      .orderBy('task.id')
      .execute();
    if (tasks.length === 0) return;

    const sender = getEmailSender();
    await withNotificationBudget(
      recipient.id,
      digest.actorUserId,
      repeatKey(project.id, digest.taskIds),
      () => sender.send(digestMessage(recipient, actor.name, project, tasks))
    );
  },
};

export async function runAssignmentDigestSweep(opts: { budgetMs?: number } = {}): Promise<number> {
  const deadline = Date.now() + (opts.budgetMs ?? DIGEST_SWEEP_BUDGET_MS);
  let processed = 0;

  while (processed < DIGEST_SWEEP_BATCH && Date.now() < deadline) {
    const groups = await dueGroups(DIGEST_SWEEP_BATCH - processed);
    if (groups.length === 0) break;

    let claimedAny = false;
    for (const group of groups) {
      processed += 1;
      let digest: AssignmentDigest | null = null;
      try {
        digest = await claimDigest(group);
      } catch (err) {
        logger.error({
          msg: 'Assignment digest could not be claimed',
          project_id: group.project_id,
          error: errorText(err),
        });
      }
      if (digest === null) continue;
      claimedAny = true;

      // Claimed rows are already gone, so a failed send loses the message rather
      // than the sweep: the alternative is holding a transaction open across an
      // SMTP call.
      try {
        await assignmentDigestDelivery.deliver(digest);
      } catch (err) {
        logger.error({
          msg: 'Assignment digest email failed',
          project_id: digest.projectId,
          error: errorText(err),
        });
      }
      if (Date.now() >= deadline) break;
    }
    // Every due group was already held by another replica; re-querying would
    // return the same untouchable set forever.
    if (!claimedAny) break;
  }

  if (processed >= DIGEST_SWEEP_BATCH) {
    logger.warn({ msg: 'Assignment digest sweep filled its batch', count: processed });
  }

  return processed;
}

export function registerAssignmentDigestJob(): void {
  registerJobHandler({
    kind: ASSIGNMENT_DIGEST_JOB_KIND,
    timeoutMs: DIGEST_SWEEP_TIMEOUT_MS,
    intervalSeconds: DIGEST_SWEEP_INTERVAL_SECONDS,
    run: async () => {
      await runAssignmentDigestSweep();
    },
  });
}
