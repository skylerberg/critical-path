import type { Kysely } from 'kysely';
import type { DB } from '../../db/types';
import { db } from '../../db/index';
import { normalizeProjectRole } from '../authorization';
import { projectSharerIdsAmong } from '../userDirectory';
import { USER_UPDATED } from './bus';
import type { BusEntry } from './bus';
import { authedSocketEntries, getSocketState, projectSockets } from './state';
import type { RealtimeSocket, SocketState } from './state';

const OPEN = 1;

function sendTo(
  candidates: Array<[RealtimeSocket, SocketState]>,
  allowedUserIds: ReadonlySet<string>,
  message: string
): void {
  for (const [socket, state] of candidates) {
    if (allowedUserIds.has(state.userId) && socket.readyState === OPEN) {
      socket.send(message);
    }
  }
}

// Capped to self plus project-sharers: that is exactly the set allowed to read
// the changed user's record at all, so nobody else may learn it changed.
async function deliverUserUpdated(
  entry: Extract<BusEntry, { type: typeof USER_UPDATED }>,
  message: string,
  dbc: Kysely<DB>
): Promise<void> {
  const changedUserId = entry.data.id;

  const candidates = authedSocketEntries();
  if (candidates.length === 0) return;

  const userIds = [...new Set(candidates.map(([, state]) => state.userId))];
  const allowed = new Set(userIds.filter((userId) => userId === changedUserId));
  const unresolved = userIds.filter((userId) => !allowed.has(userId));
  for (const userId of await projectSharerIdsAmong(dbc, changedUserId, unresolved)) {
    allowed.add(userId);
  }

  sendTo(candidates, allowed, message);
}

async function deliverProjectScoped(
  entry: BusEntry,
  message: string,
  dbc: Kysely<DB>
): Promise<void> {
  if (entry.project_id === null) return;

  const candidates: Array<[RealtimeSocket, SocketState]> = entry.broadcast
    ? authedSocketEntries()
    : projectSockets(entry.project_id).flatMap((socket) => {
        const state = getSocketState(socket);
        return state ? [[socket, state] as [RealtimeSocket, SocketState]] : [];
      });
  if (candidates.length === 0) return;

  const project = await dbc
    .selectFrom('project')
    .select('created_by')
    .where('id', '=', entry.project_id)
    .executeTakeFirst();
  if (!project) return;

  // A recipient list may only narrow what the re-check already allows: it is a
  // publisher's opinion, and this is the layer that does not take those.
  const named = entry.recipientUserIds ? new Set(entry.recipientUserIds) : null;
  const userIds = [...new Set(candidates.map(([, state]) => state.userId))].filter(
    (userId) => named === null || named.has(userId)
  );
  const allowed = new Set(userIds.filter((userId) => userId === project.created_by));
  const unresolved = userIds.filter((userId) => !allowed.has(userId));
  if (unresolved.length > 0) {
    const memberRows = await dbc
      .selectFrom('project_member')
      .select(['user_id', 'role'])
      .where('project_id', '=', entry.project_id)
      .where('user_id', 'in', unresolved)
      .execute();
    for (const row of memberRows) {
      if (entry.editorsOnly && normalizeProjectRole(row.role) !== 'editor') continue;
      allowed.add(row.user_id);
    }
  }

  sendTo(candidates, allowed, message);
}

// Only sockets registered in state (i.e. past the auth handshake) are ever
// candidates.
export async function deliver(entry: BusEntry, dbc: Kysely<DB> = db): Promise<void> {
  const message = JSON.stringify({
    type: entry.type,
    project_id: entry.project_id,
    data: entry.data,
  });

  // Ahead of the shortcuts below, each of which skips the role check: an
  // editor-scoped entry reaches nobody rather than anybody unchecked.
  if (entry.editorsOnly) {
    await deliverProjectScoped(entry, message, dbc);
    return;
  }

  if (entry.recipientUserIds) {
    sendTo(authedSocketEntries(), new Set(entry.recipientUserIds), message);
    return;
  }

  if (entry.type === USER_UPDATED) {
    await deliverUserUpdated(entry, message, dbc);
    return;
  }

  await deliverProjectScoped(entry, message, dbc);
}
