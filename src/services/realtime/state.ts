import type { CredentialKind } from '../credentials';

export interface RealtimeSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export interface SocketState {
  userId: string;
  credentialKind: CredentialKind;
  credentialId: string;
  projectIds: Set<string>;
}

// Sized for `cpath watch` with no --project, which subscribes to every board the
// account can list and has no ceiling of its own to borrow. It is a bound on
// unbounded growth rather than a quota: without one, a socket sending subscribe
// frames in a loop grows both this map and the room map for as long as it stays
// connected.
export const MAX_SUBSCRIPTIONS_PER_SOCKET = 1000;

const socketStates = new Map<RealtimeSocket, SocketState>();
const projectRooms = new Map<string, Set<RealtimeSocket>>();

export function registerSocket(
  socket: RealtimeSocket,
  credential: { kind: CredentialKind; id: string; userId: string }
): void {
  socketStates.set(socket, {
    userId: credential.userId,
    credentialKind: credential.kind,
    credentialId: credential.id,
    projectIds: new Set(),
  });
}

export function getSocketState(socket: RealtimeSocket): SocketState | undefined {
  return socketStates.get(socket);
}

export function subscribeToProject(socket: RealtimeSocket, projectId: string): boolean {
  const state = socketStates.get(socket);
  if (!state) return false;
  // Checked before the add so re-subscribing to a project already held stays
  // idempotent at the ceiling rather than becoming the one frame that fails.
  if (!state.projectIds.has(projectId) && state.projectIds.size >= MAX_SUBSCRIPTIONS_PER_SOCKET) {
    return false;
  }
  state.projectIds.add(projectId);
  let room = projectRooms.get(projectId);
  if (!room) {
    room = new Set();
    projectRooms.set(projectId, room);
  }
  room.add(socket);
  return true;
}

export function unsubscribeFromProject(socket: RealtimeSocket, projectId: string): void {
  socketStates.get(socket)?.projectIds.delete(projectId);
  const room = projectRooms.get(projectId);
  if (room) {
    room.delete(socket);
    if (room.size === 0) projectRooms.delete(projectId);
  }
}

export function removeSocket(socket: RealtimeSocket): void {
  const state = socketStates.get(socket);
  if (state) {
    for (const projectId of state.projectIds) {
      const room = projectRooms.get(projectId);
      if (room) {
        room.delete(socket);
        if (room.size === 0) projectRooms.delete(projectId);
      }
    }
  }
  socketStates.delete(socket);
}

export function projectSockets(projectId: string): RealtimeSocket[] {
  return [...(projectRooms.get(projectId) ?? [])];
}

export function authedSocketEntries(): Array<[RealtimeSocket, SocketState]> {
  return [...socketStates.entries()];
}

export function socketsForUser(userId: string): RealtimeSocket[] {
  return authedSocketEntries()
    .filter(([, state]) => state.userId === userId)
    .map(([socket]) => socket);
}

export function socketsForCredential(kind: CredentialKind, id: string): RealtimeSocket[] {
  return authedSocketEntries()
    .filter(([, state]) => state.credentialKind === kind && state.credentialId === id)
    .map(([socket]) => socket);
}

export function resetRealtimeState(): void {
  socketStates.clear();
  projectRooms.clear();
}
