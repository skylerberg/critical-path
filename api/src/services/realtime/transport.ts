import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { db } from '../../db/index';
import { hashSessionToken } from '../sessions';
import { logger } from '../../utils/logger';
import { SESSIONS_REVOKED, subscribeBus } from './bus';
import type { BusEntry } from './bus';
import { deliver } from './delivery';
import {
  getSocketState,
  registerSocket,
  removeSocket,
  socketsForUser,
  subscribeToProject,
  unsubscribeFromProject,
} from './state';

const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MISSED_PONGS = 2;
const MAX_MESSAGE_BYTES = 16 * 1024;
const CLOSE_UNAUTHORIZED = 4401;
const OPEN = 1;

export interface UpgradableServer {
  on(
    event: 'upgrade',
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void
  ): unknown;
}

export interface RealtimeHandle {
  close(): void;
}

export function closeSocketsForUser(userId: string): void {
  for (const socket of socketsForUser(userId)) {
    // close() completes asynchronously; remove now so nothing is delivered to
    // a revoked socket in the interim.
    removeSocket(socket);
    socket.close(CLOSE_UNAUTHORIZED, 'Session revoked');
  }
}

async function authenticateToken(
  token: string
): Promise<{ userId: string; sessionId: string } | null> {
  const row = await db
    .selectFrom('session')
    .innerJoin('app_user', 'app_user.id', 'session.user_id')
    .select(['session.id as session_id', 'session.expires_at', 'app_user.id as user_id'])
    .where('session.token_hash', '=', hashSessionToken(token))
    .executeTakeFirst();
  if (!row || row.expires_at.getTime() <= Date.now()) {
    return null;
  }
  return { userId: row.user_id, sessionId: row.session_id };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
    // Sessions are revocable DB rows; a socket must not outlive its session.
    void db
      .selectFrom('session')
      .select('id')
      .where('id', '=', state.sessionId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst()
      .then((row) => {
        if (!row) {
          ws.close(CLOSE_UNAUTHORIZED, 'Session revoked');
        }
      })
      .catch((err) => {
        logger.error({ msg: 'Realtime session re-check failed', error: errorText(err) });
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
      const session = await authenticateToken(message.token);
      if (!session) {
        ws.close(CLOSE_UNAUTHORIZED, 'Invalid or expired token');
        return;
      }
      // The auth timeout may have closed the socket while the lookup ran.
      if (ws.readyState !== OPEN) return;
      registerSocket(ws, session.userId, session.sessionId);
      ws.send(JSON.stringify({ type: 'auth_ok' }));
      return;
    }

    switch (message.type) {
      case 'subscribe':
        if (typeof message.project_id === 'string') {
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
    const userId = (entry.data as { user_id?: unknown } | null)?.user_id;
    if (typeof userId === 'string') {
      closeSocketsForUser(userId);
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

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
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
