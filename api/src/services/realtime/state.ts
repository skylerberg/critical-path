export interface RealtimeSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export interface SocketState {
  userId: string;
  sessionId: string;
  projectIds: Set<string>;
}

const socketStates = new Map<RealtimeSocket, SocketState>();
const projectRooms = new Map<string, Set<RealtimeSocket>>();

export function registerSocket(socket: RealtimeSocket, userId: string, sessionId: string): void {
  socketStates.set(socket, { userId, sessionId, projectIds: new Set() });
}

export function getSocketState(socket: RealtimeSocket): SocketState | undefined {
  return socketStates.get(socket);
}

export function subscribeToProject(socket: RealtimeSocket, projectId: string): boolean {
  const state = socketStates.get(socket);
  if (!state) return false;
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

export function resetRealtimeState(): void {
  socketStates.clear();
  projectRooms.clear();
}
