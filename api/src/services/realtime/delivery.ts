import type { Kysely } from 'kysely';
import type { DB } from '../../db/types';
import { db } from '../../db/index';
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

// Only sockets registered in state (i.e. past the auth handshake) are ever
// candidates.
export async function deliver(entry: BusEntry, dbc: Kysely<DB> = db): Promise<void> {
  const message = JSON.stringify({
    type: entry.type,
    project_id: entry.project_id,
    data: entry.data,
  });

  if (entry.recipientUserIds) {
    sendTo(authedSocketEntries(), new Set(entry.recipientUserIds), message);
    return;
  }

  if (entry.workspaceId !== undefined) {
    const candidates = authedSocketEntries();
    const userIds = [...new Set(candidates.map(([, state]) => state.userId))];
    if (userIds.length === 0) return;
    const memberRows = await dbc
      .selectFrom('workspace_member')
      .select('user_id')
      .where('workspace_id', '=', entry.workspaceId)
      .where('user_id', 'in', userIds)
      .execute();
    sendTo(candidates, new Set(memberRows.map((row) => row.user_id)), message);
    return;
  }

  if (entry.project_id === null) {
    return;
  }

  const candidates: Array<[RealtimeSocket, SocketState]> = entry.broadcast
    ? authedSocketEntries()
    : projectSockets(entry.project_id).flatMap((socket) => {
        const state = getSocketState(socket);
        return state ? [[socket, state] as [RealtimeSocket, SocketState]] : [];
      });
  if (candidates.length === 0) return;

  const project = await dbc
    .selectFrom('project')
    .select(['created_by', 'workspace_id'])
    .where('id', '=', entry.project_id)
    .executeTakeFirst();
  if (!project) return;

  const userIds = [...new Set(candidates.map(([, state]) => state.userId))];
  const allowed = new Set(userIds.filter((userId) => userId === project.created_by));
  const unresolved = userIds.filter((userId) => !allowed.has(userId));
  if (project.workspace_id !== null && unresolved.length > 0) {
    const memberRows = await dbc
      .selectFrom('workspace_member')
      .select('user_id')
      .where('workspace_id', '=', project.workspace_id)
      .where('user_id', 'in', unresolved)
      .execute();
    for (const row of memberRows) {
      allowed.add(row.user_id);
    }
  }

  sendTo(candidates, allowed, message);
}
