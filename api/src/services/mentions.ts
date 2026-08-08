import { projectAccessIdsAmong } from './authorization';
import { notify } from './notifications';
import type { PublicContext } from '../types/index';

// Membership already bounds who can be notified; this bounds the fan-out of a
// single write on a project with a large membership.
export const MAX_MENTION_RECIPIENTS = 25;

export type MentionSource = 'description' | 'comment';

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
    actor: { id: string; name: string };
    project: { id: string; name: string; created_by: string | null };
    taskId: string;
    source: MentionSource;
    previous: unknown;
    next: unknown;
  }
): Promise<void> {
  // Dropped before the cap rather than by `notify` after it, or mentioning
  // yourself alongside twenty-five other people would spend one of their slots.
  const added = newMentionIds(args.previous, args.next).filter((id) => id !== args.actor.id);
  if (added.length === 0) return;

  // Mentioning someone who cannot reach the project is stored and silently not
  // notified: rejecting it would leave a pasted foreign chip failing every
  // autosave with no way for the writer to find it.
  const allowed = new Set(await projectAccessIdsAmong(c.get('db'), args.project, added));
  const recipientUserIds = added.filter((id) => allowed.has(id)).slice(0, MAX_MENTION_RECIPIENTS);
  if (recipientUserIds.length === 0) return;

  await notify(c, {
    kind: 'mentioned',
    actor: args.actor,
    project: args.project,
    taskId: args.taskId,
    source: args.source,
    recipientUserIds,
  });
}
