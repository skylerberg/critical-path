import { ApiError } from './api/errors';

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
// Three times the server's heartbeat interval: no frame at all for this long means a
// half-open connection that will never produce a close event.
const STALE_TIMEOUT_MS = 90_000;
const AUTH_CLOSE_CODE = 4401;
const WS_OPEN = 1;

export interface WatchSocket {
  send(data: string): void;
  close(): void;
}

export interface WatchHandlers {
  onOpen(): void;
  onMessage(data: string): void;
  onClose(code: number): void;
}

export type Connect = (url: string, handlers: WatchHandlers) => WatchSocket;

export interface WatchOptions {
  url: string;
  token: string;
  projectId: string | null;
  projectIds: string[];
  listProjectIds: () => Promise<string[]>;
  /** `false` only when the server definitively said 401; anything inconclusive is `true`. */
  revalidateSession: () => Promise<boolean>;
  emit: (line: string) => void;
  notify: (message: string) => void;
  signal: AbortSignal;
  connect?: Connect;
}

export function realtimeUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, 'ws')}/ws`;
}

export const connectWebSocket: Connect = (url, handlers) => {
  const ws = new WebSocket(url);
  ws.onopen = () => handlers.onOpen();
  ws.onmessage = (event: MessageEvent) => {
    if (typeof event.data === 'string') {
      handlers.onMessage(event.data);
    }
  };
  ws.onclose = (event: CloseEvent) => handlers.onClose(event.code);
  ws.onerror = () => {};
  return {
    send(data: string): void {
      if (ws.readyState === WS_OPEN) {
        ws.send(data);
      }
    },
    close(): void {
      // Detaching first guarantees a socket the caller closed never calls back into it.
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    },
  };
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function watchEvents(options: WatchOptions): Promise<void> {
  const connect = options.connect ?? connectWebSocket;
  const signal = options.signal;
  const tracked = new Set(options.projectIds);

  let socket: WatchSocket | null = null;
  let generation = 0;
  let stopped = false;
  let backoff = INITIAL_BACKOFF_MS;
  let hasConnectedOnce = false;
  let hadGap = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;

  return new Promise<void>((resolve, reject) => {
    function clearTimers(): void {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      clearTimeout(staleTimer);
      staleTimer = undefined;
    }

    function settle(err?: ApiError): void {
      if (!stopped) {
        stopped = true;
        clearTimers();
        const dead = socket;
        socket = null;
        dead?.close();
      }
      signal.removeEventListener('abort', onAbort);
      if (err === undefined) {
        resolve();
      } else {
        reject(err);
      }
    }

    function onAbort(): void {
      settle();
    }

    function send(message: unknown): void {
      socket?.send(JSON.stringify(message));
    }

    function scheduleReconnect(): void {
      if (stopped) return;
      clearTimeout(reconnectTimer);
      const delay = backoff;
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      reconnectTimer = setTimeout(open, delay);
    }

    function armStaleTimer(): void {
      clearTimeout(staleTimer);
      staleTimer = setTimeout(onStale, STALE_TIMEOUT_MS);
    }

    // Recovery is driven from here rather than delegated to onClose: closing a half-open
    // socket only queues a close frame, and the adapter detaches its handlers anyway, so
    // no close event may ever arrive to re-arm anything.
    function onStale(): void {
      if (stopped) return;
      options.notify(`No frames for ${STALE_TIMEOUT_MS} ms; reconnecting`);
      hadGap = true;
      const dead = socket;
      generation += 1;
      socket = null;
      clearTimers();
      dead?.close();
      scheduleReconnect();
    }

    async function onAuthOk(gen: number): Promise<void> {
      backoff = INITIAL_BACKOFF_MS;
      if (hasConnectedOnce && options.projectId === null) {
        try {
          const ids = await options.listProjectIds();
          if (stopped || gen !== generation) return;
          tracked.clear();
          for (const id of ids) {
            tracked.add(id);
          }
        } catch (err) {
          if (stopped || gen !== generation) return;
          options.notify(
            `Could not refresh the project list (${errorText(err)}); keeping the previous subscriptions`
          );
        }
      }
      for (const id of tracked) {
        send({ type: 'subscribe', project_id: id });
      }
      // Tracked separately from `hasConnectedOnce` so a gap that opened before the first
      // connection ever succeeded still gets the line consumers resync on.
      if (hadGap) {
        options.notify('Connection restored');
        hadGap = false;
      }
      hasConnectedOnce = true;
    }

    // Subscribing to a project named by an event before that event is emitted shrinks, but
    // does not close, the window in which the new project's own events are missed.
    function trackSubscriptions(type: string, data: unknown): void {
      if (options.projectId !== null) return;
      const id = (data as { id?: unknown } | null | undefined)?.id;
      if (typeof id !== 'string') return;
      if (type === 'project_created' || type === 'project_updated') {
        if (!tracked.has(id)) {
          tracked.add(id);
          send({ type: 'subscribe', project_id: id });
        }
      } else if (type === 'project_deleted' && tracked.delete(id)) {
        send({ type: 'unsubscribe', project_id: id });
      }
    }

    function onMessage(raw: string, gen: number): void {
      armStaleTimer();
      let message: { type?: unknown; project_id?: unknown; data?: unknown };
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error('frame is not a JSON object');
        }
        message = parsed;
      } catch (err) {
        options.notify(`Ignoring unreadable frame (${errorText(err)})`);
        return;
      }
      if (typeof message.type !== 'string') {
        options.notify('Ignoring frame without a type');
        return;
      }
      if (message.type === 'auth_ok') {
        void onAuthOk(gen);
        return;
      }
      if (message.type === 'ping') {
        send({ type: 'pong' });
        return;
      }
      if (message.type === 'pong') {
        return;
      }
      trackSubscriptions(message.type, message.data);
      if (options.projectId !== null && message.project_id !== options.projectId) {
        return;
      }
      options.emit(raw);
    }

    async function onClose(code: number, gen: number): Promise<void> {
      clearTimers();
      socket = null;
      hadGap = true;
      if (code !== AUTH_CLOSE_CODE) {
        options.notify(`Realtime connection closed (code ${code}); reconnecting in ${backoff} ms`);
        scheduleReconnect();
        return;
      }
      // The server also sends 4401 for auth timeouts and rejected handshakes, so let one
      // HTTP round-trip decide whether the session is really gone. An inconclusive check
      // is a blip, not a revocation.
      let stillValid = true;
      try {
        stillValid = await options.revalidateSession();
      } catch (err) {
        options.notify(`Could not check whether the session is still valid (${errorText(err)})`);
      }
      if (stopped || gen !== generation) return;
      if (!stillValid) {
        settle(
          new ApiError(401, 'Session revoked; the realtime connection was closed by the server')
        );
        return;
      }
      options.notify(
        `Realtime connection closed with 4401 but the session is still valid; reconnecting in ${backoff} ms`
      );
      scheduleReconnect();
    }

    function open(): void {
      if (stopped) return;
      generation += 1;
      const gen = generation;
      const handlers: WatchHandlers = {
        onOpen: () => {
          if (stopped || gen !== generation) return;
          send({ type: 'auth', token: options.token });
        },
        onMessage: (data) => {
          if (stopped || gen !== generation) return;
          onMessage(data, gen);
        },
        onClose: (code) => {
          if (stopped || gen !== generation) return;
          void onClose(code, gen);
        },
      };
      let opened: WatchSocket;
      try {
        opened = connect(options.url, handlers);
      } catch (err) {
        options.notify(
          `Could not open the realtime connection (${errorText(err)}); reconnecting in ${backoff} ms`
        );
        scheduleReconnect();
        return;
      }
      socket = opened;
      armStaleTimer();
    }

    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    open();
  });
}
