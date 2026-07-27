import { projectAccessIdsAmong, type ProjectAccessFields } from './authorization';
import type { AppContext } from '../types/index';

// Membership already bounds who can be notified; this keeps an adversarial
// document from making the lookup itself expensive.
export const MAX_MENTION_RECIPIENTS = 25;

export type MentionSource = 'description' | 'comment';

export interface MentionNotification {
  actorUserId: string;
  projectId: string;
  taskId: string;
  source: MentionSource;
  recipientUserIds: string[];
}

// The single seam where notification delivery attaches. Nothing is sent today —
// there is no notification service yet — so a resolved mention is handed here
// and dropped.
export const mentionDelivery: {
  deliver: (notification: MentionNotification) => Promise<void>;
} = {
  deliver: async () => {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectInto(node: unknown, ids: Set<string>): void {
  if (!isRecord(node)) return;
  if (node.type === 'mention') {
    const id = isRecord(node.attrs) ? node.attrs.id : undefined;
    if (typeof id === 'string') {
      ids.add(id);
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

// Only mentions the previous document did not already carry are new. Without
// this every debounced description autosave would re-notify everyone named in
// the document.
export function newMentionIds(previous: unknown, next: unknown): string[] {
  const before = new Set(collectMentionIds(previous));
  return collectMentionIds(next)
    .filter((id) => !before.has(id))
    .slice(0, MAX_MENTION_RECIPIENTS);
}

export async function notifyMentions(
  c: Pick<AppContext, 'get'>,
  args: {
    actorUserId: string;
    project: ProjectAccessFields;
    taskId: string;
    source: MentionSource;
    previous: unknown;
    next: unknown;
  }
): Promise<void> {
  const added = newMentionIds(args.previous, args.next).filter((id) => id !== args.actorUserId);
  if (added.length === 0) return;

  // Mentioning someone who cannot reach the project is stored and silently not
  // notified: rejecting it would leave a pasted foreign chip failing every
  // autosave with no way for the writer to find it.
  const allowed = new Set(await projectAccessIdsAmong(c.get('db'), args.project, added));
  const recipientUserIds = added.filter((id) => allowed.has(id));
  if (recipientUserIds.length === 0) return;

  const notification: MentionNotification = {
    actorUserId: args.actorUserId,
    projectId: args.project.id,
    taskId: args.taskId,
    source: args.source,
    recipientUserIds,
  };
  c.get('postCommitHooks').push(async () => {
    await mentionDelivery.deliver(notification);
  });
}
