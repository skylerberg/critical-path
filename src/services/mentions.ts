import { projectAccessIdsAmong, type ProjectAccessFields } from './authorization';
import type { PublicContext } from '../types/index';

// Membership already bounds who can be notified; this bounds the fan-out of a
// single write on a project with a large membership.
export const MAX_MENTION_RECIPIENTS = 25;

export type MentionSource = 'description' | 'comment';

export interface MentionNotification {
  actorUserId: string;
  projectId: string;
  taskId: string;
  source: MentionSource;
  recipientUserIds: string[];
}

export type MentionDeliverer = (notification: MentionNotification) => Promise<void>;

// Nothing in the app registers one, so mentions notify nobody today: whether a
// mention should send mail is an unmade product decision, and this is the seam
// it would attach to. Null rather than a no-op function so the unwired state is
// a state `notifyMentions` can see and skip — resolving recipients for a
// deliverer that does not exist is a query per write for nothing — and so the
// difference between "sends nothing" and "sends to nobody" is visible here
// instead of only in a stack trace that never arrives.
let mentionDeliverer: MentionDeliverer | null = null;

export function setMentionDeliverer(deliverer: MentionDeliverer | null): void {
  mentionDeliverer = deliverer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectInto(node: unknown, ids: Set<string>): void {
  if (!isRecord(node)) return;
  if (node.type === 'mention') {
    const id = isRecord(node.attrs) ? node.attrs.id : undefined;
    if (typeof id === 'string') {
      // A uuid validates in any casing but Postgres only ever gives one back
      // lower-cased, so every id is canonicalized before it is compared.
      ids.add(id.toLowerCase());
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      collectInto(child, ids);
    }
  }
}

// Runs over stored documents as well as request bodies, so it assumes nothing
// about validation.
export function collectMentionIds(doc: unknown): string[] {
  const ids = new Set<string>();
  collectInto(doc, ids);
  return [...ids];
}

// Without the diff every debounced description autosave would re-notify
// everyone named in the document.
export function newMentionIds(previous: unknown, next: unknown): string[] {
  const before = new Set(collectMentionIds(previous));
  return collectMentionIds(next).filter((id) => !before.has(id));
}

export async function notifyMentions(
  c: Pick<PublicContext, 'get'>,
  args: {
    actorUserId: string;
    project: ProjectAccessFields;
    taskId: string;
    source: MentionSource;
    previous: unknown;
    next: unknown;
  }
): Promise<void> {
  const deliverer = mentionDeliverer;
  if (deliverer === null) return;

  const added = newMentionIds(args.previous, args.next).filter((id) => id !== args.actorUserId);
  if (added.length === 0) return;

  // Mentioning someone who cannot reach the project is stored and silently not
  // notified: rejecting it would leave a pasted foreign chip failing every
  // autosave with no way for the writer to find it.
  const allowed = new Set(await projectAccessIdsAmong(c.get('db'), args.project, added));
  const recipientUserIds = added.filter((id) => allowed.has(id)).slice(0, MAX_MENTION_RECIPIENTS);
  if (recipientUserIds.length === 0) return;

  const notification: MentionNotification = {
    actorUserId: args.actorUserId,
    projectId: args.project.id,
    taskId: args.taskId,
    source: args.source,
    recipientUserIds,
  };
  c.get('postCommitHooks').push(async () => {
    await deliverer(notification);
  });
}
