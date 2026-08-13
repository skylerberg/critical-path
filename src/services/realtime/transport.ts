import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { db } from '../../db/index';
import { authenticateBearerToken, credentialIsLive } from '../credentials';
import type { CredentialKind } from '../credentials';
import { errorText } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { isValidUuid } from '../../utils/uuid';
import { clientIpFrom } from '../clientIp';
import { recordPersonalAccessTokenUse } from '../personalAccessTokens';
import { SESSIONS_REVOKED, subscribeBus } from './bus';
import type { BusEntry } from './bus';
import { deliver } from './delivery';
import {
  getSocketState,
  registerSocket,
  removeSocket,
  socketsForCredential,
  socketsForUser,
  subscribeToProject,
  unsubscribeFromProject,
} from './state';
import type { RealtimeSocket } from './state';

const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MISSED_PONGS = 2;
const MAX_MESSAGE_BYTES = 16 * 1024;
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_TOO_MANY = 4429;
const OPEN = 1;

// Two ceilings, because they bound different things. Per credential holder: a
// live socket costs a `credentialIsLive` query every heartbeat, so socket count
// is a multiplier on a pool of ten connections, and one account should not be
// able to set that number. Per source address: the pre-auth window admits a
// socket before any account is known, so this is the only thing bounding what
// an unauthenticated caller can hold open.
//
// The per-address ceiling is generous on purpose — it is the whole office
// behind one NAT that pays for it being tight, while an attacker holding 200
// idle sockets costs little.
export const MAX_SOCKETS_PER_USER = 20;
export const MAX_SOCKETS_PER_ADDRESS = 200;

export interface UpgradableServer {
  on(
    event: 'upgrade',
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void
  ): unknown;
}

export interface RealtimeHandle {
  close(): void;
}

// The upgrade event types its socket as the Duplex a raw stream would be; the
// one Node hands over is always a net.Socket, and a test double need not be.
function remoteAddressOf(socket: Duplex): string | undefined {
  return (socket as Duplex & { remoteAddress?: string }).remoteAddress;
}

function closeSockets(sockets: RealtimeSocket[]): void {
  for (const socket of sockets) {
    // close() completes asynchronously; remove now so nothing is delivered to
    // a revoked socket in the interim.
    removeSocket(socket);
    socket.close(CLOSE_UNAUTHORIZED, 'Session revoked');
  }
}

// Session-scoped: a user-scoped revoke must not evict the user's still-valid
// personal access tokens.
export function closeSessionSocketsForUser(userId: string): void {
  closeSockets(
    socketsForUser(userId).filter((socket) => getSocketState(socket)?.credentialKind === 'session')
  );
}

export function closeSocketsForCredential(kind: CredentialKind, id: string): void {
  closeSockets(socketsForCredential(kind, id));
}

// Oldest first, so the connection that just arrived is the one that survives: a
// client reconnecting through a half-open socket its peer never closed would
// otherwise be refused by the sockets it is trying to replace. Removed from
// state before close() completes, for the same reason a revoke is.
function evictExcessUserSockets(userId: string): void {
  const sockets = socketsForUser(userId);
  // Guarded rather than sliced straight: a negative end index counts from the
  // end, so under the ceiling this would evict the oldest sockets instead of
  // none of them.
  const excess = sockets.length - MAX_SOCKETS_PER_USER;
  if (excess <= 0) {
    return;
  }
  for (const socket of sockets.slice(0, excess)) {
    removeSocket(socket);
    socket.close(CLOSE_TOO_MANY, 'Too many connections');
  }
}

function handleConnection(ws: WebSocket): void {
  let missedPongs = 0;

  const authTimer = setTimeout(() => {
    if (!getSocketState(ws)) {
      ws.close(CLOSE_UNAUTHORIZED, 'Authentication timeout');
    }
  }, AUTH_TIMEOUT_MS);

  const heartbeat = setInterval(() => {
    const state = getSocketState(ws);
    if (!state) return;
    if (missedPongs >= MAX_MISSED_PONGS) {
      ws.terminate();
      return;
    }
    missedPongs++;
    ws.send(JSON.stringify({ type: 'ping' }));
    // Credentials are revocable DB rows; a socket must not outlive its own.
    void credentialIsLive(db, state.credentialKind, state.credentialId)
      .then(async (live) => {
        if (!live) {
          ws.close(CLOSE_UNAUTHORIZED, 'Session revoked');
          return;
        }
        // A socket held open for days is use, so the token must not look idle.
        if (state.credentialKind === 'personal_access_token') {
          await recordPersonalAccessTokenUse(state.credentialId);
        }
      })
      .catch((err) => {
        logger.error({ msg: 'Realtime credential re-check failed', error: errorText(err) });
      });
  }, HEARTBEAT_INTERVAL_MS);

  async function handleMessage(raw: unknown): Promise<void> {
    let message: { type?: unknown; token?: unknown; project_id?: unknown };
    try {
      const parsed: unknown = JSON.parse(String(raw));
      if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
      message = parsed;
    } catch {
      ws.close(1003, 'Invalid message');
      return;
    }

    const state = getSocketState(ws);
    if (!state) {
      if (message.type !== 'auth' || typeof message.token !== 'string') {
        ws.close(CLOSE_UNAUTHORIZED, 'Expected auth message');
        return;
      }
      const credential = await authenticateBearerToken(db, message.token);
      if (!credential) {
        ws.close(CLOSE_UNAUTHORIZED, 'Invalid or expired token');
        return;
      }
      // The auth timeout may have closed the socket while the lookup ran.
      if (ws.readyState !== OPEN) return;
      registerSocket(ws, { kind: credential.kind, id: credential.id, userId: credential.user.id });
      evictExcessUserSockets(credential.user.id);
      // Evicting takes the oldest, so this socket is never the one dropped; the
      // check keeps that an assertion rather than an assumption.
      if (!getSocketState(ws)) return;
      ws.send(JSON.stringify({ type: 'auth_ok' }));
      return;
    }

    switch (message.type) {
      // A project id is only ever a uuid, and an unvalidated one is a room key
      // an attacker chooses the length and the number of.
      case 'subscribe':
        if (typeof message.project_id === 'string' && isValidUuid(message.project_id)) {
          subscribeToProject(ws, message.project_id);
        }
        return;
      case 'unsubscribe':
        if (typeof message.project_id === 'string') {
          unsubscribeFromProject(ws, message.project_id);
        }
        return;
      case 'pong':
        missedPongs = 0;
        return;
      default:
        return;
    }
  }

  ws.on('message', (raw) => {
    handleMessage(raw).catch((err) => {
      logger.error({ msg: 'Realtime message handling failed', error: errorText(err) });
      ws.close(1011, 'Internal error');
    });
  });

  ws.on('error', (err) => {
    logger.warn({ msg: 'Realtime socket error', error: errorText(err) });
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    clearInterval(heartbeat);
    removeSocket(ws);
  });
}

function handleBusEntry(entry: BusEntry): void {
  if (entry.type === SESSIONS_REVOKED) {
    const { user_id, personal_access_token_id, session_id } = entry.data;
    if (personal_access_token_id !== undefined) {
      closeSocketsForCredential('personal_access_token', personal_access_token_id);
    } else if (session_id !== undefined) {
      closeSocketsForCredential('session', session_id);
    } else {
      closeSessionSocketsForUser(user_id);
    }
    return;
  }
  deliver(entry).catch((err) => {
    logger.error({ msg: 'Realtime delivery failed', type: entry.type, error: errorText(err) });
  });
}

export function attachRealtime(server: UpgradableServer): RealtimeHandle {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const liveSockets = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    liveSockets.add(ws);
    ws.on('close', () => liveSockets.delete(ws));
    handleConnection(ws);
  });

  // Counted per live TCP socket rather than per WebSocket: a handshake that is
  // refused, or aborted before it completes, still held a connection, and only
  // the socket's own close event fires on every one of those paths.
  const socketsByAddress = new Map<string, number>();

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const address = clientIpFrom(request.headers['x-forwarded-for'], remoteAddressOf(socket));
    const held = socketsByAddress.get(address) ?? 0;
    if (held >= MAX_SOCKETS_PER_ADDRESS) {
      // Answered rather than reset, so a client that has run itself out of
      // sockets can tell that from a network fault.
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      return;
    }

    // Claimed here rather than once the socket is a WebSocket: handleUpgrade
    // completes asynchronously, so a burst would clear the check above before
    // any of it was counted.
    socketsByAddress.set(address, held + 1);
    socket.once('close', () => {
      const remaining = (socketsByAddress.get(address) ?? 1) - 1;
      if (remaining > 0) {
        socketsByAddress.set(address, remaining);
      } else {
        socketsByAddress.delete(address);
      }
    });

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  const unsubscribe = subscribeBus(handleBusEntry);

  return {
    close(): void {
      unsubscribe();
      for (const ws of liveSockets) {
        ws.close(1001, 'Server shutting down');
      }
      wss.close();
    },
  };
}
